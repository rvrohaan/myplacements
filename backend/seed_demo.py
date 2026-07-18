"""Seed two demo colleges so you can see branded portals side by side.

Run from the backend dir (with the venv active and Postgres up):

    python seed_demo.py

Then open each portal in the browser:

    http://admin.localhost:5173    login: owner@myplacements.in / demo1234  (platform console)
    http://rit.localhost:5173      login: head@rit.edu          / demo1234
    http://bmsce.localhost:5173    login: head@bmsce.edu         / demo1234

Re-running is safe: existing colleges/users are left untouched.
"""

from app.core.database import Base, SessionLocal, engine
from app.core.security import get_password_hash
from app.models.college import College
from app.models.student import PlacementStatus, Student
from app.models.user import User, UserRole
from app.services.student_scoring import assess

import app.models  # register all models before create_all

# (code/subdomain, display name, login email, brand colour for the logo)
DEMO_COLLEGES = [
    ("rit", "Ramaiah Institute of Technology", "head@rit.edu", "0D8ABC"),
    ("bmsce", "BMS College of Engineering", "head@bmsce.edu", "B23A48"),
]
DEMO_PASSWORD = "demo1234"


def _logo_url(name: str, color: str) -> str:
    """Initials-based logo so each portal looks visibly distinct."""
    label = "+".join(name.split()[:2])
    return f"https://ui-avatars.com/api/?name={label}&background={color}&color=fff&size=128&bold=true"


SUPER_ADMIN_EMAIL = "owner@myplacements.in"

# A few demo students per college with login already enabled (password = demo1234)
# so the student portal can be tried immediately. (roll, name, branch, cgpa, skills)
DEMO_STUDENTS = [
    ("CS21001", "Aarav Mehta", "CSE", 8.4, "Python, React, SQL, DSA"),
    ("CS21002", "Diya Sharma", "CSE", 7.1, "Java, Spring, MySQL"),
    ("EC21001", "Rohan Iyer", "ECE", 6.2, "C, Embedded, Verilog"),
]


def _seed_students(db, college: College) -> None:
    for roll, name, branch, cgpa, skills in DEMO_STUDENTS:
        existing = (
            db.query(Student)
            .filter(Student.roll_number == roll, Student.college_id == college.id)
            .first()
        )
        if existing:
            continue
        user = User(
            email=f"{roll.lower()}@c{college.id}.no-login.myplacement.app",
            full_name=name,
            hashed_password=get_password_hash(DEMO_PASSWORD),
            role=UserRole.STUDENT,
            college_id=college.id,
            is_active=True,  # login enabled for the demo
            must_reset_password=False,
        )
        db.add(user)
        db.flush()
        student = Student(
            user_id=user.id,
            roll_number=roll,
            branch=branch,
            batch_year=2025,
            cgpa=cgpa,
            backlogs=0,
            skills=skills,
            college_id=college.id,
        )
        student.readiness_score, student.risk_category = assess(
            cgpa, 0, skills, PlacementStatus.UNPLACED
        )
        db.add(student)
        print(f"  + student {roll:<8} {name}  (login: {roll} / {DEMO_PASSWORD})")


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Platform owner — signs in at admin.myplacements.in, has no college.
        if db.query(User).filter(User.email == SUPER_ADMIN_EMAIL).first() is None:
            db.add(
                User(
                    email=SUPER_ADMIN_EMAIL,
                    full_name="Platform Owner",
                    hashed_password=get_password_hash(DEMO_PASSWORD),
                    role=UserRole.SUPER_ADMIN,
                    college_id=None,
                )
            )
            print(f"+ owner    {SUPER_ADMIN_EMAIL}  /  {DEMO_PASSWORD}  (admin console)")
        else:
            print(f"= owner    {SUPER_ADMIN_EMAIL} (exists)")

        for code, name, email, color in DEMO_COLLEGES:
            college = db.query(College).filter(College.code == code).first()
            if college is None:
                college = College(name=name, code=code, logo_url=_logo_url(name, color))
                db.add(college)
                db.flush()  # assign college.id
                print(f"+ college  {code:<6} {name}")
            else:
                print(f"= college  {code:<6} (exists)")

            if db.query(User).filter(User.email == email).first() is None:
                db.add(
                    User(
                        email=email,
                        full_name=f"{name} Pro Chancellor",
                        hashed_password=get_password_hash(DEMO_PASSWORD),
                        role=UserRole.PRO_CHANCELLOR,
                        college_id=college.id,
                    )
                )
                print(f"+ admin    {email}  /  {DEMO_PASSWORD}")
            else:
                print(f"= admin    {email} (exists)")

            _seed_students(db, college)

        db.commit()
        print("\nDone. Open each portal:")
        print(f"  http://admin.localhost:5173   ->  {SUPER_ADMIN_EMAIL} / {DEMO_PASSWORD}  (console)")
        for code, _, email, _ in DEMO_COLLEGES:
            print(f"  http://{code}.localhost:5173   ->  staff:   {email} / {DEMO_PASSWORD}")
        print("\nStudent portal (use the 'Student' tab on a college login page):")
        print(f"  http://rit.localhost:5173     ->  student: CS21001 / {DEMO_PASSWORD}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
