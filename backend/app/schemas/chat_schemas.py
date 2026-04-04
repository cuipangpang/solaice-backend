"""
대화 모듈 Pydantic v2 스키마.
기존 schemas/ 스타일 준수.
"""

from pydantic import BaseModel


class CreateSessionRequest(BaseModel):
    pet_id: str


class CreateSessionResponse(BaseModel):
    session_id: str
    pet_id: str
    created_at: str
    stage: str
    turn_count: int


class SendMessageRequest(BaseModel):
    session_id: str
    pet_id: str
    content: str
    image_url: str | None = None
    mode: str = "fast"  # "fast" | "thinking"


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    image_url: str | None
    turn_index: int
    created_at: str


class SessionListItem(BaseModel):
    session_id: str
    pet_id: str
    turn_count: int
    stage: str
    is_active: bool
    created_at: str
    updated_at: str
