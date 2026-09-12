import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardList,
  Phone,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useNotifications } from '@/store/notifications'
import { cn, timeAgo } from '@/lib/utils'
import type { AppNotification } from '@/types'

// Notification types are open-ended strings from the backend, so match on the
// family prefix and fall back to the bell rather than listing all 21.
const TYPE_ICONS: { prefix: string; icon: LucideIcon }[] = [
  { prefix: 'drive.cancelled', icon: AlertTriangle },
  { prefix: 'drive.application', icon: UserPlus },
  { prefix: 'drive.selections', icon: CheckCircle2 },
  { prefix: 'drive.', icon: Briefcase },
  { prefix: 'assignment.escalated', icon: AlertTriangle },
  { prefix: 'assignment.', icon: Building2 },
  { prefix: 'company.', icon: Building2 },
  { prefix: 'daily_update.', icon: ClipboardList },
  { prefix: 'followup.', icon: Phone },
]

function iconFor(type: string): LucideIcon {
  return TYPE_ICONS.find((entry) => type.startsWith(entry.prefix))?.icon ?? Bell
}

export function NotificationRow({
  notification,
  onSelect,
}: {
  notification: AppNotification
  onSelect: (n: AppNotification) => void
}) {
  const Icon = iconFor(notification.type)
  const unread = !notification.is_read
  return (
    <button
      type="button"
      onClick={() => onSelect(notification)}
      className={cn(
        'w-full text-left flex gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0',
        'hover:bg-gray-50 transition-colors',
        unread && 'bg-blue-50/60',
        notification.priority === 'high' && 'border-l-2 border-l-rose-400'
      )}
    >
      <Icon
        className={cn(
          'w-4 h-4 mt-0.5 shrink-0',
          notification.priority === 'high' ? 'text-rose-500' : 'text-gray-400'
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span
            className={cn(
              'text-sm flex-1 min-w-0',
              unread ? 'font-semibold text-gray-900' : 'text-gray-600'
            )}
          >
            {notification.title}
          </span>
          <span className="text-[11px] text-gray-400 whitespace-nowrap shrink-0 mt-0.5">
            {timeAgo(notification.created_at)}
          </span>
        </span>
        {notification.body && (
          <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2">
            {notification.body}
          </span>
        )}
      </span>
      {unread && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0"
          aria-hidden="true"
        />
      )}
    </button>
  )
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const { items, unread, loading, open, setOpen, markRead, markAllRead } = useNotifications()

  // The interval itself is owned by the store; this only kicks off the first
  // fetch so the badge is right on the very first paint.
  useEffect(() => {
    void useNotifications.getState().fetchUnread()
  }, [])

  const handleSelect = (n: AppNotification) => {
    void markRead(n.id)
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
        >
          <Bell className="w-5 h-5" aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-rose-500 to-orange-500 text-white text-[10px] font-semibold leading-[18px] text-center shadow-sm shadow-rose-500/40"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[380px] p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-800">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              Mark all as read
            </button>
          )}
        </div>

        <div className="max-h-[380px] overflow-y-auto">
          {loading && items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              You&rsquo;re all caught up.
            </p>
          ) : (
            items.map((n) => (
              <NotificationRow key={n.id} notification={n} onSelect={handleSelect} />
            ))
          )}
        </div>

        <div className="border-t border-gray-100 px-4 py-2 text-right">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            View all
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
