from fastapi import Request,FastAPI,HTTPException
import uvicorn



app = FastAPI()


@app.get("/")
async def main():
    return {
        "Message" : "Skazka API"
    }



if __name__ == "__main__":
    uvicorn.run(app,host = "127.0.0.1",port = 8080) # run