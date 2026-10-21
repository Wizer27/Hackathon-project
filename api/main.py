from fastapi import Request,FastAPI,HTTPException,status
import uvicorn
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import aiohttp
import os
from dotenv import load_dotenv
import uuid
from typing  import Optional
from pydantic import BaseModel
from database.main_db.main_core import create_user,get_user_data_for_jwt
from database.jwt_db.jwt_core import create_refresh_token_db,delete_jwt_tokens,get_user_refresh_token
from api.auth import create_access_token,create_refresh_token
from jose import jwt,JWTError

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_ID_SITE = os.getenv("GOOGLE_CLIENT_ID_SITE")


app = FastAPI()


@app.get("/")
async def main(request:Request):
    return {
        "Message" : "Skazka API"
    }


class AuthGoogle(BaseModel):
    id_token:str

@app.post("/auth/google")
async def auth_google_handler(request:Request,req:AuthGoogle):

    try:
        main_google_client_id = GOOGLE_CLIENT_ID if  req.method == "app" else GOOGLE_CLIENT_ID_SITE
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
        device_id:str = payload.get("device_id")


        if user_id is None or device_id is None:
            raise credentials_exception

        stored_token = await get_user_refresh_token(user_id)
        if stored_token != req.refresh_token:
            raise credentials_exception

        user_data = await get_user_data_for_jwt(user_id)

        if user_data == {} or not user_data.get("provider"):
            raise credentials_exception

        user_data["device_id"] = device_id

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
        device_id: str = payload.get("device_id")
        if user_id is None or device_id is None:
            raise credentials_exception

        return {
            "user_id":user_id,
            "device_id":device_id
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





if __name__ == "__main__":
    uvicorn.run(app,host = "127.0.0.1",port = 8080) # run