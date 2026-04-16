import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';
import { CreatePackageRequest } from '../types/therapist';

const router = Router();

// GET /api/therapists - Public: Get all active therapists
router.get('/', async (req: Request, res: Response) => {
  try {
    const { data: therapists, error } = await supabase
      .from('therapist_profiles')
      .select('user_id, full_name, clinic_name, specialty, bio, avatar_url')
      .eq('is_accepting_patients', true);

    if (error) throw error;
    res.json(therapists);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch therapists' });
  }
});

// GET /api/therapists/:id/packages - Public: Get packages for a therapist
router.get('/:id/packages', async (req: Request, res: Response) => {
  try {
    const { data: packages, error } = await supabase
      .from('therapist_packages')
      .select('*')
      .eq('therapist_id', req.params.id)
      .eq('active', true);

    if (error) throw error;
    res.json(packages);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

// POST /api/therapists/packages - Protected: Therapist creates a package
router.post('/packages', authenticate, async (req: Request, res: Response) => {
  try {
    const therapistId = req.userId;
    const body: CreatePackageRequest = req.body;
    
    if (!body.title || !body.durationMonths || !body.price) {
      res.status(400).json({ error: 'Missing required package fields' });
      return;
    }

    const { data, error } = await supabase
      .from('therapist_packages')
      .insert({
        therapist_id: therapistId,
        title: body.title,
        duration_months: body.durationMonths,
        price: body.price,
        description: body.description,
        therapy_goals: body.therapyGoals || []
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create package' });
  }
});

// PUT /api/therapists/profile - Protected: Therapist updates profile
router.put('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const therapistId = req.userId;
    const { bio, isAcceptingPatients, clinicName, specialty, fullName, avatarBase64 } = req.body;

    let avatarUrl: string | undefined = undefined;

    if (avatarBase64) {
        // Break apart data:image/png;base64,.....
        const matches = avatarBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            const mimeType = matches[1];
            const base64Data = matches[2];
            const extension = mimeType.split('/')[1] || 'png';
            const fileName = `therapist_${therapistId}_${Date.now()}.${extension}`;
            
            const buffer = Buffer.from(base64Data, 'base64');
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(fileName, buffer, {
                    contentType: mimeType,
                    upsert: true
                });
                
            if (!uploadError) {
                const { data: publicUrlData } = supabase.storage
                    .from('avatars')
                    .getPublicUrl(fileName);
                avatarUrl = publicUrlData.publicUrl;
            } else {
                console.error("Storage upload failed", uploadError);
            }
        }
    }

    const payload: any = {
        user_id: therapistId,
        bio, 
        is_accepting_patients: isAcceptingPatients, 
        clinic_name: clinicName, 
        specialty,
        full_name: fullName,
        updated_at: new Date().toISOString()
    };
    
    if (avatarUrl) {
        payload.avatar_url = avatarUrl;
    }

    const { data, error } = await supabase
      .from('therapist_profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
