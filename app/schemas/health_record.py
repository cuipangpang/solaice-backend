from pydantic import BaseModel, UUID4
from typing import Optional, List, Any
from datetime import datetime

MODULE_LABELS = {
    "skin": "皮肤",
    "oral": "口腔",
    "ear": "耳部",
    "eye": "眼部",
    "excrement": "排泄物",
    "vomit": "呕吐物",
}


class HealthRecordCreate(BaseModel):
    pet_id: UUID4
    module: str                           # skin|oral|ear|eye|excrement|vomit
    urgency: str                          # normal|caution|visit|emergency
    primary_diagnosis: str
    action_plan: str
    confidence_level: Optional[str] = None  # high|medium|low
    symptoms: Optional[List[Any]] = []
    image_url: Optional[str] = None
    image_key: Optional[str] = None

    @property
    def module_label(self) -> str:
        return MODULE_LABELS.get(self.module, self.module)


class HealthRecordResponse(BaseModel):
    id: UUID4
    pet_id: UUID4
    created_at: datetime
    module: str
    module_label: str
    urgency: str
    primary_diagnosis: str
    action_plan: str
    confidence_level: Optional[str]
    symptoms: Optional[List[Any]]
    image_url: Optional[str]
    image_key: Optional[str]

    model_config = {"from_attributes": True}


class HealthRecordStatsResponse(BaseModel):
    total: int
    last_check_at: Optional[datetime]
    by_module: dict
