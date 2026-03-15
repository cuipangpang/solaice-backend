import boto3
import os
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from typing import Tuple

load_dotenv()

AWS_ACCESS_KEY_ID     = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION            = os.getenv("AWS_REGION", "ap-northeast-2")
S3_BUCKET_NAME        = os.getenv("S3_BUCKET_NAME", "solaice-pet-health-dev")

_s3_client = None


def _client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            region_name=AWS_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        )
    return _s3_client


def generate_presigned_upload_url(key: str, content_type: str, expires: int = 3600) -> Tuple[str, str]:
    """
    生成预签名上传URL。前端直接 PUT 到 upload_url，不经过后端。
    返回: (upload_url, public_image_url)
    """
    upload_url = _client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": S3_BUCKET_NAME,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=expires,
        HttpMethod="PUT",
    )
    image_url = f"https://{S3_BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{key}"
    return upload_url, image_url


def delete_object(key: str) -> bool:
    """删除S3对象（检测记录删除时联动调用）"""
    try:
        _client().delete_object(Bucket=S3_BUCKET_NAME, Key=key)
        return True
    except ClientError:
        return False


def generate_presigned_download_url(key: str, expires: int = 3600) -> str:
    """生成临时访问URL（私有bucket时使用）"""
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET_NAME, "Key": key},
        ExpiresIn=expires,
    )
