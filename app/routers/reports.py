from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from datetime import date, datetime, timezone
from io import BytesIO
from typing import Optional

from app.database import get_db
from app.models.pet_profile import PetProfile
from app.models.health_record import HealthRecord
from app.models.vaccine_record import VaccineRecord

router = APIRouter()

URGENCY_LABEL = {
    "normal": "🟢 正常",
    "caution": "🟡 注意",
    "visit": "🟠 建议就医",
    "emergency": "🔴 紧急",
}

MODULE_LABEL = {
    "skin": "皮肤",
    "oral": "口腔",
    "ear": "耳朵",
    "eye": "眼睛",
    "excrement": "粪便",
    "vomit": "呕吐物",
}


def _build_pdf(pet: PetProfile, records: list, vaccines: list) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
    )
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont

    # 注册支持中文的字体
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    CN = "STSong-Light"

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2.5 * cm,
        rightMargin=2.5 * cm,
        topMargin=2.5 * cm,
        bottomMargin=2.5 * cm,
    )

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", fontName=CN, fontSize=20, leading=28, textColor=colors.HexColor("#2B3A55"), spaceAfter=6)
    h2 = ParagraphStyle("H2", fontName=CN, fontSize=14, leading=20, textColor=colors.HexColor("#2B3A55"), spaceAfter=4)
    h3 = ParagraphStyle("H3", fontName=CN, fontSize=11, leading=16, textColor=colors.HexColor("#7A8DA3"), spaceAfter=2)
    body = ParagraphStyle("Body", fontName=CN, fontSize=10, leading=15, textColor=colors.HexColor("#2B3A55"), spaceAfter=3)
    meta = ParagraphStyle("Meta", fontName=CN, fontSize=9, leading=13, textColor=colors.HexColor("#7A8DA3"), spaceAfter=2)

    species_map = {"cat": "猫咪", "dog": "狗狗", "other": "其他"}
    species_label = species_map.get(pet.species, pet.species)
    pet_info_parts = [species_label]
    if pet.breed:
        pet_info_parts.append(pet.breed)
    if pet.age_years is not None:
        pet_info_parts.append(f"{pet.age_years} 岁")
    pet_info = " · ".join(pet_info_parts)

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    story = []

    # ── 封面 ──────────────────────────────────────────────────────
    story.append(Spacer(1, 1 * cm))
    story.append(Paragraph(f"{pet.name} 的健康档案报告", h1))
    story.append(Paragraph(pet_info, h3))
    story.append(Spacer(1, 0.3 * cm))

    if records:
        date_range_start = records[0].created_at.strftime("%Y-%m-%d") if records else "—"
        date_range_end   = records[-1].created_at.strftime("%Y-%m-%d") if records else "—"
        story.append(Paragraph(f"报告时间范围：{date_range_start} ~ {date_range_end}", meta))
    story.append(Paragraph(f"生成时间：{generated_at}", meta))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#BDE0FE"), spaceAfter=16))

    # ── 检测记录 ──────────────────────────────────────────────────
    story.append(Paragraph("检测记录", h2))
    story.append(Spacer(1, 0.2 * cm))

    if not records:
        story.append(Paragraph("该时间段内暂无检测记录。", body))
    else:
        for r in records:
            urgency_text = URGENCY_LABEL.get(r.urgency, r.urgency)
            module_text  = r.module_label or MODULE_LABEL.get(r.module, r.module)
            rec_date     = r.created_at.strftime("%Y-%m-%d")

            story.append(Paragraph(f"{rec_date}　{module_text}　{urgency_text}", h3))
            story.append(Paragraph(f"主要诊断：{r.primary_diagnosis}", body))
            story.append(Paragraph(f"行动建议：{r.action_plan}", body))

            # 症状列表
            symptoms = r.symptoms or []
            if symptoms:
                sym_lines = []
                for s in symptoms:
                    if isinstance(s, dict):
                        name = s.get("name", "")
                        desc = s.get("description", "")
                        sym_lines.append(f"• {name}：{desc}" if desc else f"• {name}")
                    else:
                        sym_lines.append(f"• {s}")
                story.append(Paragraph("症状：", meta))
                for line in sym_lines:
                    story.append(Paragraph(line, meta))

            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#E8EFF6"), spaceAfter=8))

    story.append(Spacer(1, 0.5 * cm))

    # ── 疫苗记录 ──────────────────────────────────────────────────
    story.append(Paragraph("疫苗记录", h2))
    story.append(Spacer(1, 0.2 * cm))

    if not vaccines:
        story.append(Paragraph("暂无疫苗记录。", body))
    else:
        table_data = [["疫苗类型", "接种日期", "下次提醒"]]
        for v in vaccines:
            next_due = str(v.next_due_at) if v.next_due_at else "—"
            table_data.append([v.type, str(v.administered_at), next_due])

        tbl = Table(table_data, colWidths=[5 * cm, 4 * cm, 4 * cm])
        tbl.setStyle(TableStyle([
            ("FONTNAME",        (0, 0), (-1, -1), CN),
            ("FONTSIZE",        (0, 0), (-1, -1), 10),
            ("BACKGROUND",      (0, 0), (-1, 0),  colors.HexColor("#BDE0FE")),
            ("TEXTCOLOR",       (0, 0), (-1, 0),  colors.HexColor("#2B3A55")),
            ("FONTSIZE",        (0, 0), (-1, 0),  10),
            ("GRID",            (0, 0), (-1, -1), 0.5, colors.HexColor("#E8EFF6")),
            ("ROWBACKGROUNDS",  (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F8FF")]),
            ("VALIGN",          (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",      (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING",   (0, 0), (-1, -1), 6),
        ]))
        story.append(tbl)

    doc.build(story)
    return buf.getvalue()


@router.get("/reports/generate")
async def generate_report(
    pet_id: UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    db: AsyncSession = Depends(get_db),
):
    # 1. 宠物基础信息
    pet_result = await db.execute(
        select(PetProfile).where(PetProfile.id == pet_id, PetProfile.deleted_at.is_(None))
    )
    pet = pet_result.scalar_one_or_none()
    if not pet:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="宠物档案不存在")

    # 2. 时间范围内的检测记录（升序）
    records_result = await db.execute(
        select(HealthRecord)
        .where(
            HealthRecord.pet_id == pet_id,
            HealthRecord.deleted_at.is_(None),
            HealthRecord.created_at >= datetime.combine(start_date, datetime.min.time()),
            HealthRecord.created_at <= datetime.combine(end_date, datetime.max.time()),
        )
        .order_by(HealthRecord.created_at.asc())
    )
    records = records_result.scalars().all()

    # 3. 疫苗记录
    vaccines_result = await db.execute(
        select(VaccineRecord)
        .where(VaccineRecord.pet_id == pet_id, VaccineRecord.deleted_at.is_(None))
        .order_by(VaccineRecord.administered_at.asc())
    )
    vaccines = vaccines_result.scalars().all()

    # 4. 生成 PDF
    pdf_bytes = _build_pdf(pet, list(records), list(vaccines))

    filename = f"pet_health_report_{pet.name}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
