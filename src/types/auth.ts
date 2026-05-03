/// Authentication request and response types

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  role?: 'guardian' | 'therapist';
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  userId: string;
  user: {
    id: string;
    email: string;
    fullName?: string;
    role?: string;
  };
}

export interface ErrorResponse {
  error: string;
  message?: string;
}


