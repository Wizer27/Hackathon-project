import math
import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import os
from typing import List
#from backend.database.custom_gpt_select_db.select_core import get_user_gpt
#from backend.database.custom_gpt_db.custom_core import get_gpt_settings
#from backend.api.psw_hash import decrypt


load_dotenv()

database_url = "postgresql+asyncpg://postgres.regqtbofstblnnsovack:270710_030565@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"



async_engine = create_async_engine(
    database_url,
    pool_size=5,          
    max_overflow=5,       
    pool_recycle=3600,    
    pool_pre_ping=True,     
    echo=False,
    connect_args={"ssl": "require"},
)



AsyncSessionLocal = sessionmaker(
    async_engine, 
    class_=AsyncSession,
    expire_on_commit=False
)