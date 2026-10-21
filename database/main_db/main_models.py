from sqlalchemy import Table,Column,String,MetaData




metadata_obj = MetaData()


main_table = Table(
    "main_table",
    metadata_obj,
    Column("provider_id",String,primary_key = True,unique=True),
    Column("user_id",String,primary_key = True,unique=True),
    Column("provider",String),
    Column("email",String),
    Column("name",String),
    Column("profile_pict",String),
)