import { apiRequest } from './apiClient'

interface PresignedUrlResponse {
  upload_url: string
  image_url: string
  key: string
}

/**
 * 上传图片到 S3（预签名 URL 直传）。
 * S3 不可用时静默返回 null，不阻塞检测记录保存主流程。
 */
export async function uploadImage(
  localUri: string,
  folder: 'avatars' | 'health-checks',
  petId: string,
): Promise<string | null> {
  try {
    // 1. 向后端请求预签名 URL
    const { upload_url, image_url } = await apiRequest<PresignedUrlResponse>(
      '/upload/presigned-url',
      {
        method: 'POST',
        body: JSON.stringify({
          filename: `${Date.now()}.jpg`,
          content_type: 'image/jpeg',
          folder,
          pet_id: petId,
        }),
      },
    )

    // 2. 读取本地文件为 Blob（React Native fetch 支持 file:// URI）
    const fileResponse = await fetch(localUri)
    const blob = await fileResponse.blob()

    // 3. PUT 到 S3 预签名 URL
    const uploadResponse = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    })

    if (!uploadResponse.ok) throw new Error('S3上传失败')
    return image_url
  } catch (error) {
    console.warn('图片上传失败，跳过:', error)
    return null
  }
}
