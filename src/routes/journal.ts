import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/journal - Get all notes for the authenticated user
router.get('/', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: 'User ID not found' });
            return;
        }

        const { data: notes, error } = await supabase
            .from('guardian_notes')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching journal notes:', error);
            res.status(500).json({ error: 'Failed to fetch notes' });
            return;
        }

        res.json(notes);
    } catch (error) {
        console.error('Journal fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/journal - Create a new note
router.post('/', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: 'User ID not found' });
            return;
        }

        const { note_text, milestone_type } = req.body;

        if (!note_text || typeof note_text !== 'string' || note_text.trim() === '') {
            res.status(400).json({ error: 'A valid note_text is required.' });
            return;
        }

        const { data, error } = await supabase
            .from('guardian_notes')
            .insert([
                {
                    user_id: userId,
                    note_text: note_text.trim(),
                    milestone_type: milestone_type || null
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('Error creating journal note:', error);
            res.status(500).json({ error: 'Failed to create note' });
            return;
        }

        res.status(201).json(data);
    } catch (error) {
        console.error('Journal create error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/journal/:id - Delete a specific note
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        const noteId = req.params.id;

        if (!userId) {
            res.status(401).json({ error: 'User ID not found' });
            return;
        }

        // Attempt to delete where note id matches AND user_id matches (security)
        const { error } = await supabase
            .from('guardian_notes')
            .delete()
            .eq('id', noteId)
            .eq('user_id', userId);

        if (error) {
            console.error('Error deleting journal note:', error);
            res.status(500).json({ error: 'Failed to delete note' });
            return;
        }

        res.status(200).json({ success: true, message: 'Note deleted successfully' });
    } catch (error) {
        console.error('Journal delete error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
