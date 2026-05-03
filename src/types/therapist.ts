export interface TherapistPackage {
  id: string;
  therapistId: string;
  title: string;
  durationMonths: number;
  price: number;
  description?: string;
  therapyGoals: string[];
  active: boolean;
  createdAt: string;
}

export interface TherapistProfile {
  id: string;
  userId: string;
  fullName?: string;
  clinicName?: string;
  specialty?: string;
  bio?: string;
  isAcceptingPatients: boolean;
}

export type BookingStatus = 'pending' | 'active' | 'completed' | 'rejected';

export interface TherapistBooking {
  id: string;
  therapistId: string;
  guardianId: string;
  packageId?: string;
  status: BookingStatus;
  preferredSchedule?: any;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePackageRequest {
  title: string;
  durationMonths: number;
  price: number;
  description?: string;
  therapyGoals?: string[];
}

export interface CreateBookingRequest {
  therapistId: string;
  packageId?: string;
  preferredSchedule: any;
}
