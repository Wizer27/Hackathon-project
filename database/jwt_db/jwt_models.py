from sqlalchemy import Table,Column,MetaData,String


metadata_obj = MetaData()

jwt_table = Table(
    "jwt_table",
    metadata_obj,
    Column("user_id",String,primary_key = True,unique=True),
    Column("token",String)
)