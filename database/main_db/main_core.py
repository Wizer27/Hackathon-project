from sqlalchemy import text,select,and_
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.dialects.postgresql import insert
from datetime import datetime,timedelta
from typing import List,Literal,Dict
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv
from database.main_db.main_models import metadata_obj,main_table
import asyncio
import atexit
from sqlalchemy import func
import logging
import uuid
from api.config import database_url,async_engine
#backend.database.


logger = logging.getLogger(__name__)




# ---- INIT ---- 

async def drop_table():
    async with async_engine.begin() as conn:
        await conn.run_sync(metadata_obj.drop_all)

async def create_table():
    async with async_engine.begin() as conn:
        await conn.run_sync(metadata_obj.create_all)

# For the existing table: create_all doesn't add new columns.
async def migrate_table():
    async with async_engine.begin() as conn:
        await conn.execute(text("ALTER TABLE main_app_table ADD COLUMN IF NOT EXISTS video_credits INTEGER DEFAULT 0"))
        await conn.execute(text("ALTER TABLE main_app_table ADD COLUMN IF NOT EXISTS last_premium_refil VARCHAR DEFAULT ''"))
        

async def get_user_id_by_provider(provider_id:str,provider:str) -> str:
    async with AsyncSession(async_engine) as conn:
        try:
            stmt = select(main_table.c.user_id).where(
                main_table.c.provider == provider,
                main_table.c.provider_id == provider_id
            )
            res = await conn.execute(stmt)
            data = res.scalar_one_or_none()
            return data if data is not None else ""
        except Exception:
            logger.exception("MAIN SQL ERROR")
            return "" 

async def get_user_id_by_email(email:str) -> str:
    async with AsyncSession(async_engine) as conn:
        try:
            stmt = select(main_table.c.user_id).where(main_table.c.email == email)
            res = await conn.execute(stmt)
            data = res.scalar_one_or_none()
            return data if data is not None else ""
        except Exception:
            logger.exception("MAIN SQL ERROR")
            return ""
        
async def create_user(user_id:str,name:str,email:str,provider_id:str = None, provider:str = None,avatar_url:str = None ) -> bool | str:
    
    async with AsyncSession(async_engine) as conn:
        async with conn.begin():
            try:
                stmt = insert(main_table).values(
                    provider_id = provider_id,
                    provider = provider,
                    email = email,
                    user_id = user_id,
                    name = name,
                    profile_pict = avatar_url,
                ).on_conflict_do_nothing(
                    index_elements=[main_table.c.provider_id]
                )
                result = await conn.execute(stmt)
                if result.rowcount == 0:
                    if provider_id is not None:
                        user_id = await get_user_id_by_provider(
                            provider = provider,
                            provider_id=provider_id
                        )
                        return user_id
                    elif provider == "email" and provider_id is None:
                        user_id = await get_user_id_by_email(email)
                        return user_id
                return True
            except Exception as e:
                logger.exception(f"MAIN SQL Error")
                return False

        
async def get_user_data_for_jwt(user_id:str) -> dict:
    
    async with AsyncSession(async_engine) as conn:
        try:
            stmt = select(main_table.c.name,main_table.c.provider).where(main_table.c.user_id == user_id)
            res = await conn.execute(stmt)
            data = res.fetchone()

            if not data:
                return {}
            
            name,provider = data

            return {
                "user_id":user_id,
                "name":name,
                "provider":provider
            }


        except Exception:
            logger.exception("MAIN SQL ERROR")
            return {}
