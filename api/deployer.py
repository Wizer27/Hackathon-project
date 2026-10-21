from api.config import async_engine


from database.main_db.main_models import metadata_obj as m1
from database.email_code_db.email_models import metadata_obj as m2
from database.jwt_db.jwt_models import metadata_obj as m3


import subprocess
import asyncio
import os


all_metadata = [m1, m2, m3]

async def create_all():
    async with async_engine.begin() as conn:
        for meta in all_metadata:
            await conn.run_sync(meta.create_all)

    await async_engine.dispose()

def redis_check():
    result = subprocess.run(
        ["redis-cli", "ping"],
        capture_output=True,
        text=True
    )

    if result.stdout.strip() != "PONG":
        print("[+] REDIS IS NOT STARTED")

    else:
        print("[+] REDIS STARTED")






async def drop_all():
    async with async_engine.begin() as conn:
        for meta in all_metadata:
            await conn.run_sync(meta.drop_all)

    await async_engine.dispose()

if __name__ == "__main__":
    #redis_check()
    #asyncio.run(write_default())
    asyncio.run(create_all())
    #asyncio.run(drop_all())

