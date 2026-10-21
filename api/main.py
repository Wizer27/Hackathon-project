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
from database.main_db.main_core import create_user
from api.auth import create_access_token,create_refresh_token


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

    try_create_refresh = await create_new_device(user_id_main,req.device_name,refresh_token,req.device_id)


    return {
        "user_id":user_id_main,
        "access_token":acces_token,
        "refresh_token":refresh_token,
        "token_type":"bearer"
    }



if __name__ == "__main__":
    uvicorn.run(app,host = "127.0.0.1",port = 8080) # run