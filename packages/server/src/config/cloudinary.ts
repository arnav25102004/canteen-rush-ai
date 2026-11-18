import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

/** Menu photo uploads are optional: without all three keys the upload endpoint answers 503. */
export const cloudinaryConfigured = !!(
  process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
  process.env.CLOUDINARY_API_KEY?.trim() &&
  process.env.CLOUDINARY_API_SECRET?.trim()
);

export async function uploadImage(
  filePath: string,
  folder: string = 'campus-khana'
): Promise<string> {
  const result = await cloudinary.uploader.upload(filePath, {
    folder,
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  });
  return result.secure_url;
}

/** Upload an in-memory image. Callers must check cloudinaryConfigured first. */
export async function uploadBuffer(buf: Buffer, folder: string): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', transformation: [{ quality: 'auto', fetch_format: 'auto' }] },
      (err, result) => (err || !result ? reject(err ?? new Error('Upload failed')) : resolve({ url: result.secure_url, publicId: result.public_id })),
    );
    stream.end(buf);
  });
}

/** Best effort: never throws. */
export async function deleteAsset(publicId: string): Promise<boolean> {
  if (!cloudinaryConfigured) return false;
  try {
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch {
    return false;
  }
}
