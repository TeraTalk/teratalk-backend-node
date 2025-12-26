import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import {
  RegisterRequest,
  LoginRequest,
  RefreshTokenRequest,
  AuthResponse,
  ErrorResponse,
} from '../types/auth';

const router = Router();

/// Validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/// Validate password strength
function isValidPassword(password: string): boolean {
  return password.length >= 8;
}

/// POST /api/auth/register - Register new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, fullName }: RegisterRequest = req.body;

    // Validation
    if (!email || !password || !fullName) {
      const errorResponse: ErrorResponse = {
        error: 'Missing required fields',
        message: 'Email, password, and full name are required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (!isValidEmail(email)) {
      const errorResponse: ErrorResponse = {
        error: 'Invalid email format',
        message: 'Please provide a valid email address',
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (!isValidPassword(password)) {
      const errorResponse: ErrorResponse = {
        error: 'Invalid password',
        message: 'Password must be at least 8 characters long',
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (fullName.trim().length < 2) {
      const errorResponse: ErrorResponse = {
        error: 'Invalid full name',
        message: 'Full name must be at least 2 characters long',
      };
      res.status(400).json(errorResponse);
      return;
    }

    // Create user in Supabase
    // Note: JWT expiration is configured in Supabase Dashboard (Authentication > Settings > JWT Settings)
    // Default is 1 hour, should be set to 30 days (2592000 seconds) for 1 month expiration
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password: password,
      options: {
        data: {
          full_name: fullName.trim(),
        },
      },
    });

    if (error) {
      console.error('Registration error:', error);
      
      // Handle specific Supabase errors
      if (error.message.includes('already registered') || error.message.includes('already exists')) {
        const errorResponse: ErrorResponse = {
          error: 'Email already exists',
          message: 'An account with this email already exists. Please log in instead.',
        };
        res.status(409).json(errorResponse);
        return;
      }

      const errorResponse: ErrorResponse = {
        error: 'Registration failed',
        message: error.message || 'Failed to create account',
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (!data.user || !data.session) {
      const errorResponse: ErrorResponse = {
        error: 'Registration failed',
        message: 'Failed to create user session',
      };
      res.status(500).json(errorResponse);
      return;
    }

    // Return auth response
    const authResponse: AuthResponse = {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      userId: data.user.id,
      user: {
        id: data.user.id,
        email: data.user.email || email,
        fullName: data.user.user_metadata?.full_name || fullName.trim(),
      },
    };

    res.status(201).json(authResponse);
  } catch (error) {
    console.error('Registration error:', error);
    const errorResponse: ErrorResponse = {
      error: 'Internal server error',
      message: 'An unexpected error occurred during registration',
    };
    res.status(500).json(errorResponse);
  }
});

/// POST /api/auth/login - Login user
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password }: LoginRequest = req.body;

    // Validation
    if (!email || !password) {
      const errorResponse: ErrorResponse = {
        error: 'Missing required fields',
        message: 'Email and password are required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (!isValidEmail(email)) {
      const errorResponse: ErrorResponse = {
        error: 'Invalid email format',
        message: 'Please provide a valid email address',
      };
      res.status(400).json(errorResponse);
      return;
    }

    // Sign in with Supabase
    // Note: JWT expiration is configured in Supabase Dashboard (Authentication > Settings > JWT Settings)
    // Default is 1 hour, should be set to 30 days (2592000 seconds) for 1 month expiration
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: password,
    });

    if (error) {
      console.error('Login error:', error);
      
      // Handle specific Supabase errors
      if (error.message.includes('Invalid login credentials') || 
          error.message.includes('Invalid password') ||
          error.message.includes('Email not confirmed')) {
        const errorResponse: ErrorResponse = {
          error: 'Invalid credentials',
          message: 'Invalid email or password. Please try again.',
        };
        res.status(401).json(errorResponse);
        return;
      }

      const errorResponse: ErrorResponse = {
        error: 'Login failed',
        message: error.message || 'Failed to sign in',
      };
      res.status(401).json(errorResponse);
      return;
    }

    if (!data.user || !data.session) {
      const errorResponse: ErrorResponse = {
        error: 'Login failed',
        message: 'Failed to create user session',
      };
      res.status(500).json(errorResponse);
      return;
    }

    // Return auth response
    const authResponse: AuthResponse = {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      userId: data.user.id,
      user: {
        id: data.user.id,
        email: data.user.email || email,
        fullName: data.user.user_metadata?.full_name,
      },
    };

    res.status(200).json(authResponse);
  } catch (error) {
    console.error('Login error:', error);
    const errorResponse: ErrorResponse = {
      error: 'Internal server error',
      message: 'An unexpected error occurred during login',
    };
    res.status(500).json(errorResponse);
  }
});

/// POST /api/auth/logout - Logout user (optional)
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(200).json({ message: 'Logged out successfully' });
      return;
    }

    const token = authHeader.substring(7);
    
    // Sign out the user session
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Logout error:', error);
      // Still return success as logout is best-effort
    }

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    // Still return success as logout is best-effort
    res.status(200).json({ message: 'Logged out successfully' });
  }
});

/// POST /api/auth/refresh - Refresh access token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken }: RefreshTokenRequest = req.body;

    if (!refreshToken) {
      const errorResponse: ErrorResponse = {
        error: 'Missing refresh token',
        message: 'Refresh token is required',
      };
      res.status(400).json(errorResponse);
      return;
    }

    // Refresh the session
    // Note: JWT expiration is configured in Supabase Dashboard (Authentication > Settings > JWT Settings)
    // The refreshed token will use the project-level JWT expiration setting
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      console.error('Token refresh error:', error);
      const errorResponse: ErrorResponse = {
        error: 'Invalid refresh token',
        message: 'Refresh token is invalid or expired. Please log in again.',
      };
      res.status(401).json(errorResponse);
      return;
    }

    // Return new tokens
    const authResponse: AuthResponse = {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      userId: data.user.id,
      user: {
        id: data.user.id,
        email: data.user.email || '',
        fullName: data.user.user_metadata?.full_name,
      },
    };

    res.status(200).json(authResponse);
  } catch (error) {
    console.error('Token refresh error:', error);
    const errorResponse: ErrorResponse = {
      error: 'Internal server error',
      message: 'An unexpected error occurred during token refresh',
    };
    res.status(500).json(errorResponse);
  }
});

export default router;

