from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from datetime import datetime,timezone
import logging
from database.game_db.game_models import metadata_obj,game_table
from api.config import async_engine


logger = logging.getLogger(__name__)


# ---- INIT ----

async def create_table():
    async with async_engine.begin() as conn:
        await conn.run_sync(metadata_obj.create_all)


async def save_game(user_id:str,state:dict):
    """Сохраняет состояние игры, возвращает время сохранения (ISO) или None при ошибке."""
    now = datetime.now(timezone.utc)
    async with AsyncSession(async_engine) as conn:
        async with conn.begin():
            try:
                stmt = insert(game_table).values(
                    user_id = user_id,
                    state = state,
                    updated_at = now
                ).on_conflict_do_update(
                    index_elements=[game_table.c.user_id],
                    set_ = {
                        "state":state,
                        "updated_at":now
                    }
                )
                await conn.execute(stmt)
                return now.isoformat()
            except Exception:
                logger.exception("GAME SQL ERROR")
                return None


async def load_game(user_id:str):
    """Возвращает {"state": ..., "updated_at": ...} или None, если сохранения нет."""
    async with AsyncSession(async_engine) as conn:
        try:
            stmt = select(game_table.c.state,game_table.c.updated_at).where(game_table.c.user_id == user_id)
            res = await conn.execute(stmt)
            data = res.fetchone()
            if not data:
                return None
            state,updated_at = data
            return {
                "state":state,
                "updated_at":updated_at.isoformat() if updated_at else None
            }
        except Exception:
            logger.exception("GAME SQL ERROR")
            return None
