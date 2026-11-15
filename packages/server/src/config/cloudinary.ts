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
