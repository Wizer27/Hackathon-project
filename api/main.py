from fastapi import Request,FastAPI,HTTPException,status,Header,Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import aiohttp
import os
from dotenv import load_dotenv
import uuid
from typing  import Optional,Literal
import json
from pydantic import BaseModel,EmailStr
from database.main_db.main_core import create_user,get_user_data_for_jwt,get_user_profile
from database.game_db.game_core import save_game,load_game,create_table as create_game_table
from database.jwt_db.jwt_core import create_refresh_token_db,delete_jwt_tokens,get_user_refresh_token
from database.email_code_db.email_core import create_code,delete_line,check_code
from api.auth import create_access_token,create_refresh_token
from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTError
import secrets
import logging 


GOOGLE_CLIENT_ID_SITE = os.getenv("GOOGLE_CLIENT_ID_SITE")

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app:FastAPI):
    await create_game_table()  # таблица сохранений игры создаётся при старте, если её ещё нет
    yield

app = FastAPI(lifespan = lifespan)

# Через Caddy сайт и API на одном домене (/api/...), CORS нужен только для локальной разработки
app.add_middleware(
    CORSMiddleware,
    allow_origins = [o for o in os.getenv("ALLOWED_ORIGINS","").split(",") if o],
    allow_origin_regex = r"http://(localhost|127\.0\.0\.1)(:\d+)?",  # локальная разработка с любого порта
    allow_methods = ["*"],
    allow_headers = ["*"],
)


@app.get("/")
async def main(request:Request):
    return {
        "Message" : "Skazka API"
    }


@app.get("/config")
async def public_config():
    """Публичные настройки для сайта: client_id для кнопки «Войти через Google»."""
    return {"google_client_id":GOOGLE_CLIENT_ID_SITE}


class AuthGoogle(BaseModel):
    id_token:str
    method:Literal["site","app"] = "site"

@app.post("/auth/google")
async def auth_google_handler(request:Request,req:AuthGoogle):

    try:
        main_google_client_id =  GOOGLE_CLIENT_ID_SITE
        idinfo = id_token.verify_oauth2_token(
            req.id_token,
            google_requests.Request(),
            main_google_client_id
        )
    except Exception:
        raise HTTPException(status_code = status.HTTP_401_UNAUTHORIZED,detail = "Invalid google token")

    issuer = idinfo.get("iss")
    if issuer not in ["accounts.google.com", "https://accounts.google.com"]:
        raise HTTPException(status_code=401, detail="Invalid token issuer")

    google_sub = idinfo.get("sub")
    email = idinfo.get("email")
    email_verified = idinfo.get("email_verified", False)
    name = idinfo.get("name", "")
    picture = idinfo.get("picture", "")

    if not google_sub:
        raise HTTPException(status_code=401, detail="Google sub not found")

    if email and not email_verified:
        raise HTTPException(status_code=401, detail="Email is not verified")


    user_id_main = str(uuid.uuid4())
    # default sql data
    user_id_try = await create_user(
        user_id = user_id_main,
        name = name,
        email = email,
        provider_id = google_sub,
        provider = "google",
        avatar_url=picture
    )


    if type(user_id_try) == str:
        user_id_main = user_id_try
        


    user_data = {
        "user_id":user_id_main,
        "name":name,
        "provider":"google"
    }

    acces_token:str = create_access_token(user_data)
    refresh_token:str = create_refresh_token(user_data)

    try_create_refresh = await create_refresh_token_db(user_id_main,refresh_token)


    return {
        "user_id":user_id_main,
        "access_token":acces_token,
        "refresh_token":refresh_token,
        "token_type":"bearer"
    }


async def send_email_code(email: str, code: str):
    url = "https://api.resend.com/emails"

    headers = {
        "Authorization": f"Bearer {os.getenv('EMAIL_API_KEY')}",
        "Content-Type": "application/json"
    }

    payload = {
    "from": os.getenv("EMAIL_FROM"),
    "to": [email],
    "subject": "Парк «Сказка»: код для входа",
    "html": f"""
    <div style="font-family: Arial, sans-serif; background-color:#f5f5f5; padding:40px; color:#111111;">
        <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; padding:30px; text-align:center; border:1px solid #e5e7eb;">

            <h1 style="color:#111111; letter-spacing:1px;">Парк «Сказка»</h1>

            <h2 style="margin-top:20px; color:#1f2937;">Код для входа в игру</h2>

            <p style="color:#4b5563; font-size:16px;">
                Введите этот код на сайте, чтобы войти в аккаунт.
            </p>

            <div style="margin:30px 0;">
                <span style="
                    display:inline-block;
                    font-size:32px;
                    letter-spacing:8px;
                    padding:15px 25px;
                    background:#111111;
                    border-radius:10px;
                    color:#ffffff;
                    font-weight:bold;
                ">
                    {code}
                </span>
            </div>

            <p style="color:#6b7280;">
                Код действует <b>2 минуты</b>.
            </p>

            <p style="margin-top:20px; color:#9ca3af; font-size:14px;">
                Если вы не запрашивали код, просто проигнорируйте это письмо.
            </p>

        </div>
    </div>
    """
}

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload, headers=headers) as resp:
            if resp.status >= 400:
                text = await resp.text()
                raise Exception(f"Ошибка отправки: {text}")


class AuthWithEmail(BaseModel):
    email:EmailStr


@app.post("/send/code")

async def send_code(request:Request,req:AuthWithEmail):

    try:



        code = secrets.randbelow(900000) + 100000
        try_create_code = await create_code(req.email,code)
        if not try_create_code:
            raise HTTPException(status_code = status.HTTP_400_BAD_REQUEST,detail = "Code already sent")


        await send_email_code(req.email,code)
        return {"status":"sent"}

    except HTTPException:
        raise
    except Exception:
        logger.exception("API ERROR")
        raise HTTPException(status_code = status.HTTP_500_INTERNAL_SERVER_ERROR,detail = "Server error")

class Verify_Code(BaseModel):
    email:EmailStr
    code:int

@app.post("/check/code")
async def check_code_router(request:Request,req:Verify_Code):

    try:

        email_parts = req.email.split("@")

        check_result = await check_code(req.email,req.code)
        if not check_result:
            raise HTTPException(status_code = status.HTTP_400_BAD_REQUEST,detail = "Invalid or expired code")


        # default sql data
        user_id_main = str(uuid.uuid4())


        user_id_try = await create_user(
            user_id = user_id_main,
            name = email_parts[0],
            email = req.email,
            provider_id = req.email,
            provider = "email",
            avatar_url=None
        )


        if type(user_id_try) == str:
            user_id_main = user_id_try



        user_data = {
            "user_id":user_id_main,
            "name":email_parts[0],
            "provider":"email"
        }

        acces_token:str = create_access_token(user_data)
        refresh_token:str = create_refresh_token(user_data)

        try_create_refresh = await create_refresh_token_db(user_id_main,refresh_token)


        return {
            "user_id":user_id_main,
            "access_token":acces_token,
            "refresh_token":refresh_token,
            "token_type":"bearer"
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("API ERROR")
        raise HTTPException(status_code = status.HTTP_500_INTERNAL_SERVER_ERROR,detail = "Server error")





class RefreshToken(BaseModel):
    refresh_token:str

@app.post("/refresh")
async def refresh_token_api(request:Request,req:RefreshToken):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Invalid refresh token",
    )

    try:
        payload = jwt.decode(req.refresh_token, os.getenv("REFRESH_SECRET_KEY"), algorithms=[os.getenv("ALGORITHM")])
        user_id: str = payload.get("user_id")

        if user_id is None or payload.get("type") != "refresh":
            raise credentials_exception

        stored_token = await get_user_refresh_token(user_id)
        if stored_token != req.refresh_token:
            raise credentials_exception

        user_data = await get_user_data_for_jwt(user_id)

        if user_data == {} or not user_data.get("provider"):
            raise credentials_exception

    except JWTError:
        raise credentials_exception


    new_access_token = create_access_token(user_data)

    new_refresh_token = create_refresh_token(user_data)

    await create_refresh_token_db(user_id,new_refresh_token)


    return {
        "user_id":user_id,
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer"
    }

async def get_current_user(token: str = Header(..., alias="Authorization")) -> dict:
    """
    Проверяет access token и возвращает данные пользователя.
    Токен должен передаваться в формате: "Bearer <token>"
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        # Проверяем формат токена
        if not token.startswith("Bearer "):
            raise credentials_exception

        # Извлекаем сам токен
        token = token.replace("Bearer ", "")

        # Декодируем токен
        payload = jwt.decode(
            token,
            os.getenv("SECRET_KEY"),
            algorithms=[os.getenv("ALGORITHM")]
        )

        user_id: str = payload.get("user_id")
        if user_id is None or payload.get("type") != "access":
            raise credentials_exception

        return {
            "user_id":user_id
        }


    except ExpiredSignatureError:
        # Токен истек - клиент должен использовать refresh
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError:
        raise credentials_exception





# ---- Игра ----

@app.get("/me")
async def me(user:dict = Depends(get_current_user)):
    profile = await get_user_profile(user["user_id"])
    if not profile:
        raise HTTPException(status_code = status.HTTP_404_NOT_FOUND,detail = "User not found")
    return profile


MAX_SAVE_BYTES = 200_000

class GameSave(BaseModel):
    state:dict

@app.get("/game/load")
async def game_load(user:dict = Depends(get_current_user)):
    data = await load_game(user["user_id"])
    return data or {"state":None,"updated_at":None}

@app.post("/game/save")
async def game_save(req:GameSave,user:dict = Depends(get_current_user)):
    if len(json.dumps(req.state)) > MAX_SAVE_BYTES:
        raise HTTPException(status_code = status.HTTP_413_CONTENT_TOO_LARGE,detail = "Save is too large")
    updated_at = await save_game(user["user_id"],req.state)
    if updated_at is None:
        raise HTTPException(status_code = status.HTTP_500_INTERNAL_SERVER_ERROR,detail = "Server error")
    return {"updated_at":updated_at}


if __name__ == "__main__":
    uvicorn.run(app,host = "127.0.0.1",port = 47813) # run