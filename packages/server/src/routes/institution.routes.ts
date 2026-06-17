import { Router } from 'express';
import { listInstitutions, getInstitutionCanteens, getInstitutionBySlug } from '../controllers/institution.controller';

const router = Router();

router.get('/', listInstitutions);
router.get('/slug/:slug', getInstitutionBySlug);
router.get('/:id/canteens', getInstitutionCanteens);

export default router;
