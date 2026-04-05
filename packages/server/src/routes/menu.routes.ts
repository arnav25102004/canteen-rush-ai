import { Router } from 'express';
import {
  createCategory, updateCategory, deleteCategory,
  createMenuItem, updateMenuItem, deleteMenuItem,
  toggleItemAvailability, uploadItemImage,
} from '../controllers/menu.controller';
import { authenticate, requireVendor } from '../middleware/auth';
import multer from 'multer';

const upload = multer({ dest: '/tmp/uploads/' });
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

export default router;
