from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class TrainingModule(Base):
    __tablename__ = "training_modules"

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    student_records = relationship(
        "StudentTraining", back_populates="module", cascade="all, delete-orphan"
    )


class StudentTraining(Base):
    __tablename__ = "student_training"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    module_id = Column(Integer, ForeignKey("training_modules.id"), nullable=False)
    score = Column(Float, nullable=True)
    attendance_percent = Column(Float, nullable=True)
    mock_test_score = Column(Float, nullable=True)
    status = Column(String, default="enrolled")
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("Student", back_populates="training_records")
    module = relationship("TrainingModule", back_populates="student_records")
