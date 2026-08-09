import { Router } from 'express';
import {
  createCategory, updateCategory, deleteCategory,
  createMenuItem, updateMenuItem, deleteMenuItem,
  toggleItemAvailability, uploadItemImage,
  getFavorites, addFavorite, removeFavorite,
} from '../controllers/menu.controller';
import { authenticate, requireVendor } from '../middleware/auth';
import multer from 'multer';

// Menu item photos only. Without limits/fileFilter any vendor could upload
// files of any type and unbounded size and fill the container's disk.
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
    fields: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG and WebP images are allowed'));
    }
    cb(null, true);
  },
});

const router = Router();

// Category management (vendor)
router.post('/categories', authenticate, requireVendor, createCategory);
router.put('/categories/:id', authenticate, requireVendor, updateCategory);
router.delete('/categories/:id', authenticate, requireVendor, deleteCategory);

// Menu item management (vendor)
router.post('/items', authenticate, requireVendor, createMenuItem);
router.put('/items/:id', authenticate, requireVendor, updateMenuItem);
router.patch('/items/:id/availability', authenticate, requireVendor, toggleItemAvailability);
router.delete('/items/:id', authenticate, requireVendor, deleteMenuItem);
router.post('/items/:id/image', authenticate, requireVendor, upload.single('image'), uploadItemImage);

// Favorites (authenticated students)
router.get('/favorites', authenticate, getFavorites);
router.post('/favorites/:menuItemId', authenticate, addFavorite);
router.delete('/favorites/:menuItemId', authenticate, removeFavorite);

export default router;
