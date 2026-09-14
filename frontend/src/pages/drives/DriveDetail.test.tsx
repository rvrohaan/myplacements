/**
 * pages/drives/DriveDetail.tsx - the page somebody works from during a drive.
 *
 * Status changes here are applied optimistically: the row moves the moment it
 * is clicked, and rolls back if the server refuses. That is the right choice -
 * a coordinator marking forty students during an interview round cannot wait on
 * a round trip each time - but it means a failed write must not leave the screen
 * claiming something that did not happen. That rollback is the thing most worth
 * pinning here.
 *
 * The page reads its drive from the URL, so unlike the other page tests this one
 * mounts inside a route.
 */
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ConfirmProvider } from '@/components/ui/confirm'
import { ToastProvider } from '@/components/ui/toast'
import DriveDetail from '@/pages/drives/DriveDetail'

import { HttpResponse, http, server } from '../../test/server'
import {
  fakeUser,
  render,
  screen,
  setHost,
  signIn,
  userEvent,
  waitFor,
  within,
} from '../../test/utils'

function drive(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    company_id: 7,
    company_name: 'Acme Corp',
    job_role: 'Software Engineer',
    drive_date: '2026-09-20T09:00:00',
    mode: 'offline',
    status: 'upcoming',
    min_cgpa: 7.0,
    eligible_branches: 'CSE,ECE',
    max_backlogs: 0,
    ctc_offered: 12.0,
    location: 'Bengaluru',
    total_rounds: 3,
    rounds: [],
    ...overrides,
  }
}

function participant(overrides: Record<string, unknown> = {}) {
  return {
    id: 31,
    student_id: 5,
    student_name: 'Asha Rao',
    roll_number: '1RV001',
    branch: 'CSE',
    cgpa: 8.5,
    status: 'registered',
    round_results: [],
    ...overrides,
  }
}

/** DriveDetail reads :id from the route, so it has to be mounted under one. */
function renderAt(ui: ReactElement, path = '/drives/1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/drives/:id" element={ui} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

function stub({ driveRow = drive(), participants = [participant()] } = {}) {
  server.use(
    http.get('/api/drives/:id', () => HttpResponse.json(driveRow)),
    http.get('/api/drives/:id/participants', () => HttpResponse.json(participants)),
    http.get('/api/companies/:id', () => HttpResponse.json({ id: 7, name: 'Acme Corp' })),
  )
}

beforeEach(() => {
  setHost('rit.myplacements.in')
  signIn(fakeUser({ role: 'pro_chancellor' }))
  stub()
})

describe('loading a drive', () => {
  it('shows the drive and who applied', async () => {
    renderAt(<DriveDetail />)
    expect(await screen.findByText(/software engineer/i)).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
  })

  it('says so when the drive does not exist', async () => {
    // A stale link or a deleted drive. A blank page would look like a hang.
    server.use(
      http.get('/api/drives/:id', () => HttpResponse.json({ detail: 'Not found' }, { status: 404 })),
      http.get('/api/drives/:id/participants', () => HttpResponse.json([])),
    )
    renderAt(<DriveDetail />)
    expect(await screen.findByText(/drive not found/i)).toBeInTheDocument()
  })

  it('reads another college’s drive as not found too', async () => {
    // The API answers 404 rather than 403 precisely so the page has nothing
    // special to do here - and this proves it does nothing special.
    server.use(
      http.get('/api/drives/:id', () =>
        HttpResponse.json({ detail: 'Drive not found' }, { status: 404 }),
      ),
      http.get('/api/drives/:id/participants', () => HttpResponse.json([])),
    )
    renderAt(<DriveDetail />)
    expect(await screen.findByText(/drive not found/i)).toBeInTheDocument()
  })

  it('still shows the drive when the company lookup fails', async () => {
    // The company panel is context; the drive is the page.
    server.use(
      http.get('/api/companies/:id', () => HttpResponse.json({}, { status: 500 })),
    )
    renderAt(<DriveDetail />)
    expect(await screen.findByText(/software engineer/i)).toBeInTheDocument()
  })

  it('says nobody has applied rather than showing an empty table', async () => {
    stub({ participants: [] })
    renderAt(<DriveDetail />)
    expect(await screen.findByText(/no students have applied yet/i)).toBeInTheDocument()
  })

  it('counts the applicants', async () => {
    stub({ participants: [participant(), participant({ id: 32, roll_number: '1RV002' })] })
    renderAt(<DriveDetail />)
    expect(await screen.findByText('Applicants (2)')).toBeInTheDocument()
  })
})

describe('moving a student through the drive', () => {
  function statusSelectFor(name: string) {
    // Scoped to the table: the package dialog repeats the student's name, so an
    // unscoped lookup finds two once it is open.
    const table = screen.getAllByRole('table')[0]
    const row = within(table).getByText(name).closest('tr')!
    return within(row).getByRole('combobox')
  }

  it('applies the change immediately rather than waiting on the server', async () => {
    // A coordinator marking forty students mid-round cannot wait on a round
    // trip each time.
    let resolveWrite: () => void = () => {}
    server.use(
      http.put('/api/drives/:id/participants/:pid', async () => {
        await new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
        return HttpResponse.json({})
      }),
    )
    renderAt(<DriveDetail />)
    await screen.findByText('Asha Rao')

    await userEvent.selectOptions(statusSelectFor('Asha Rao'), 'shortlisted')

    // Still in flight, and the row has already moved.
    expect(statusSelectFor('Asha Rao')).toHaveValue('shortlisted')
    resolveWrite()
  })

  it('rolls the row back when the server refuses', async () => {
    // The other half of being optimistic. Without this the screen claims
    // something that did not happen, and nothing on it says otherwise.
    server.use(
      http.put('/api/drives/:id/participants/:pid', () =>
        HttpResponse.json({ detail: 'nope' }, { status: 400 }),
      ),
    )
    renderAt(<DriveDetail />)
    await screen.findByText('Asha Rao')

    await userEvent.selectOptions(statusSelectFor('Asha Rao'), 'shortlisted')

    await waitFor(() => expect(statusSelectFor('Asha Rao')).toHaveValue('registered'))
  })

  it('sends the new status to the server', async () => {
    let body: unknown
    server.use(
      http.put('/api/drives/:id/participants/:pid', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({})
      }),
    )
    renderAt(<DriveDetail />)
    await screen.findByText('Asha Rao')

    await userEvent.selectOptions(statusSelectFor('Asha Rao'), 'rejected')

    await waitFor(() => expect(body).toMatchObject({ status: 'rejected' }))
  })

  it('asks for the package before recording a selection', async () => {
    // Selecting somebody is the moment a placement becomes real, and the CTC is
    // what every downstream figure is built from - so it is captured then
    // rather than left to be filled in later, or never.
    server.use(
      http.put('/api/drives/:id/participants/:pid', () => {
        throw new Error('nothing should be written before the package is given')
      }),
    )
    renderAt(<DriveDetail />)
    await screen.findByText('Asha Rao')

    await userEvent.selectOptions(statusSelectFor('Asha Rao'), 'selected')

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('leaves the row alone while the package is being asked for', async () => {
    // Cancelling the dialog must not leave a selection half-recorded.
    server.use(
      http.put('/api/drives/:id/participants/:pid', () => HttpResponse.json({})),
    )
    renderAt(<DriveDetail />)
    await screen.findByText('Asha Rao')

    await userEvent.selectOptions(statusSelectFor('Asha Rao'), 'selected')
    await screen.findByRole('dialog')

    expect(statusSelectFor('Asha Rao')).toHaveValue('registered')
  })
})

describe('closing a drive', () => {
  it('offers to mark an upcoming drive completed', async () => {
    renderAt(<DriveDetail />)
    await screen.findByText(/software engineer/i)
    expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument()
  })

  it('does not offer it twice', async () => {
    stub({ driveRow: drive({ status: 'completed' }) })
    renderAt(<DriveDetail />)
    await screen.findByText(/software engineer/i)
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument()
  })

  it('does not offer it on a cancelled drive', async () => {
    // Cancelled and completed are different endings, and one must not be
    // reachable from the other by accident.
    stub({ driveRow: drive({ status: 'cancelled' }) })
    renderAt(<DriveDetail />)
    await screen.findByText(/software engineer/i)
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument()
  })

  it('reflects the new status once the server confirms it', async () => {
    server.use(
      http.put('/api/drives/:id', () => HttpResponse.json(drive({ status: 'completed' }))),
    )
    renderAt(<DriveDetail />)
    await screen.findByText(/software engineer/i)

    await userEvent.click(screen.getByRole('button', { name: /complete/i }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument(),
    )
  })
})
