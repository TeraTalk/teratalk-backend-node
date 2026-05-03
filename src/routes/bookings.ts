import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';
import { CreateBookingRequest } from '../types/therapist';

const router = Router();

// POST /api/bookings - Protected: Guardian creates a booking
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const guardianId = req.userId;
    const body: CreateBookingRequest = req.body;

    if (!body.therapistId || !body.packageId) {
      res.status(400).json({ error: 'Therapist and package required' });
      return;
    }

    const { data, error } = await supabase
      .from('therapist_bookings')
      .insert({
        guardian_id: guardianId,
        therapist_id: body.therapistId,
        package_id: body.packageId,
        preferred_schedule: body.preferredSchedule || {},
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create booking request' });
  }
});

// GET /api/bookings - Protected: View incoming/outgoing bookings
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    // RLS handles filtering automatically if user is guardian or therapist
    const { data, error } = await supabase
      .from('therapist_bookings')
      .select('*, therapist_packages(*)')
      .or(`guardian_id.eq.${userId},therapist_id.eq.${userId}`);

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// PUT /api/bookings/:id - Protected: Therapist accepts/rejects a booking
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const therapistId = req.userId;
    const bookingId = req.params.id;
    const { status, startDate, endDate } = req.body;

    if (!['active', 'rejected', 'completed'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const updateData: any = { status, updated_at: new Date().toISOString() };
    if (status === 'active') {
       if (!startDate || !endDate) {
          res.status(400).json({ error: 'Active status requires start and end dates' });
          return;
       }
       updateData.start_date = startDate;
       updateData.end_date = endDate;
    }

    const { data, error } = await supabase
      .from('therapist_bookings')
      .update(updateData)
      .eq('id', bookingId)
      .eq('therapist_id', therapistId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// GET /api/bookings/patients - Protected: Therapist views accepted patients
router.get('/patients', authenticate, async (req: Request, res: Response) => {
  try {
    const therapistId = req.userId;
    
    // Get unique guardian IDs from active bookings
    const { data: bookings, error: bookingsError } = await supabase
      .from('therapist_bookings')
      .select('guardian_id')
      .eq('therapist_id', therapistId)
      .eq('status', 'active');
      
    if (bookingsError) throw bookingsError;
    if (!bookings || bookings.length === 0) return res.json([]);
    
    const guardianIds = [...new Set(bookings.map(b => b.guardian_id))];
    
    // RLS naturally protects this layer
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('*')
      .in('user_id', guardianIds);

    if (profilesError) throw profilesError;
    res.json(profiles);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// GET /api/bookings/patients/:guardianId/activity - Protected: Therapist views patient activity logs
router.get('/patients/:guardianId/activity', authenticate, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('user_speech_attempts')
      .select('*')
      .eq('user_id', req.params.guardianId)
      .order('created_at', { ascending: false })
      .limit(100);
      
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch patient activity' });
  }
});

// GET /api/bookings/patients/:guardianId/feedback - Protected: Thread history
router.get('/patients/:guardianId/feedback', authenticate, async (req: Request, res: Response) => {
  try {
    // RLS cleanly allows only the involved parties to read this thread
    const { data, error } = await supabase
      .from('therapist_feedback')
      .select('*')
      .eq('guardian_id', req.params.guardianId)
      .order('created_at', { ascending: true });
      
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch feedback thread' });
  }
});

// POST /api/bookings/patients/:guardianId/feedback - Protected: Add feedback note
router.post('/patients/:guardianId/feedback', authenticate, async (req: Request, res: Response) => {
  try {
    const { message, bookingId } = req.body;
    
    const { data, error } = await supabase
      .from('therapist_feedback')
      .insert({
         booking_id: bookingId,
         therapist_id: req.userId,
         guardian_id: req.params.guardianId,
         message
      })
      .select()
      .single();
      
    if (error) throw error;
    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to post feedback' });
  }
});

export default router;
