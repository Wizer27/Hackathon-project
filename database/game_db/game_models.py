from sqlalchemy import Table,MetaData,Column,String,DateTime
from sqlalchemy.dialects.postgresql import JSONB


metadata_obj = MetaData()

# сохранение игры: одна строка на игрока, состояние парка целиком в JSON
game_table = Table(
    "game_saves_table",
    metadata_obj,
    Column("user_id",String,primary_key = True),
    Column("state",JSONB),
    Column("updated_at",DateTime(timezone=True))
)
