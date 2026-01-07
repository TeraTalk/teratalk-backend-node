# Teratalk Backend API

A Node.js TypeScript Express backend API for Teratalk, a speech therapy application designed to help children improve their pronunciation through interactive games and personalized practice sessions.

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Running the Project](#running-the-project)
- [Database Setup](#database-setup)
- [Services Integration](#services-integration)
- [SODA Model Integration](#soda-model-integration)

## ✨ Features

- **Authentication & Authorization**
  - User registration and login
  - JWT token-based authentication
  - Token refresh mechanism
  - Secure password validation

- **User Onboarding**
  - Child profile creation
  - Speech level assessment (beginner, intermediate, advanced)
  - Problem sounds identification
  - Caregiver schedule configuration
  - Automatic difficulty level assignment

- **Profile Management**
  - View and update user profiles
  - Manage problem sounds
  - Update caregiver schedules
  - Track game progression

- **Speech Evaluation**
  - Audio file upload and analysis
  - AI-powered pronunciation assessment
  - Personalized feedback based on user profile
  - Phoneme detection and error analysis
  - Integration with SODA pronunciation model

- **Games & Progression**
  - Game level management (1-5)
  - Difficulty-based progression
  - Level updates based on performance

- **Notifications**
  - Firebase Cloud Messaging (FCM) integration
  - Contextual notifications (Morning, Afternoon, Evening, Dinner)
  - Scheduled notifications based on caregiver preferences
  - Timezone-aware notification delivery
  - Device registration and management

- **Notification Preferences**
  - Customizable notification times
  - Enable/disable notifications
  - Multiple notification time slots per day

## 🛠 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **File Upload**: Multer
- **Scheduling**: node-cron
- **Date Handling**: date-fns, date-fns-tz

## 📦 Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Supabase account and project
- Firebase project with FCM enabled
- Python 3.x (for SODA model integration)

## 🚀 Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd teratalk-backend-node
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables (see [Environment Variables](#environment-variables))

4. Build the project:
```bash
npm run build
```

## 🔐 Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Firebase Configuration
# Option 1: Use service account JSON file (place firebase-service-account.json in root)
# Option 2: Use environment variables
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_PRIVATE_KEY=your_firebase_private_key
FIREBASE_CLIENT_EMAIL=your_firebase_client_email
```

### Firebase Setup

You can configure Firebase in two ways:

1. **Service Account JSON File** (Recommended):
   - Download your Firebase service account JSON file
   - Place it in the root directory as `firebase-service-account.json`

2. **Environment Variables**:
   - Set `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, and `FIREBASE_CLIENT_EMAIL` in your `.env` file
   - Note: `FIREBASE_PRIVATE_KEY` should include `\n` characters for newlines

## 📁 Project Structure

```
teratalk-backend-node/
├── src/
│   ├── config/           # Configuration files
│   │   ├── firebase.ts    # Firebase Admin SDK setup
│   │   └── supabase.ts    # Supabase client setup
│   ├── middleware/        # Express middleware
│   │   ├── auth.ts        # Authentication middleware
│   │   └── upload.ts      # File upload middleware
│   ├── routes/            # API route handlers
│   │   ├── auth.ts        # Authentication routes
│   │   ├── onboarding.ts  # Onboarding routes
│   │   ├── profile.ts     # Profile management routes
│   │   ├── evaluation.ts  # Speech evaluation routes
│   │   ├── games.ts       # Game management routes
│   │   ├── notifications.ts # Notification routes
│   │   └── notification_preferences.ts # Notification preferences routes
│   ├── services/          # Business logic services
│   │   ├── ai_service.ts  # AI speech analysis service
│   │   ├── notification_service.ts # FCM notification service
│   │   ├── notification_scheduler.ts # Scheduled notifications
│   │   ├── notification_preferences_service.ts # Notification preferences
│   │   ├── personalization_service.ts # Response personalization
│   │   └── message_generator.ts # Notification message generation
│   ├── types/             # TypeScript type definitions
│   │   ├── auth.ts
│   │   ├── evaluation.ts
│   │   ├── notifications.ts
│   │   └── onboarding.ts
│   └── index.ts           # Application entry point
├── SODA_model/            # Python pronunciation analysis model
│   ├── app.py             # Flask API for pronunciation analysis
│   ├── exercise_bank.json # Phoneme exercise bank
│   └── requirements.txt   # Python dependencies
├── package.json
├── tsconfig.json
└── README.md
```

## 🔌 API Endpoints

### Authentication

- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/refresh` - Refresh access token

### Onboarding

- `POST /api/onboarding` - Submit onboarding data (requires authentication)

### Profile

- `GET /api/profile/check` - Check if user profile exists (requires authentication)
- `PUT /api/profile` - Update user profile (requires authentication)

### Evaluation

- `POST /api/evaluation/analyze` - Analyze speech pronunciation with audio file

### Games

- `PUT /api/games/level` - Update user's current game level (requires authentication)

### Notifications

- `POST /api/notifications/register` - Register device FCM token (requires authentication)
- `POST /api/notifications/unregister` - Unregister device (requires authentication)
- `POST /api/notifications/test` - Send test notification (requires authentication)
- `POST /api/notifications/demo` - Send demo contextual notification (requires authentication)

### Notification Preferences

- `GET /api/notification-preferences` - Get user notification preferences (requires authentication)
- `PUT /api/notification-preferences` - Update notification preferences (requires authentication)

### Health Check

- `GET /` - Welcome message
- `GET /health` - Health check endpoint

## 🏃 Running the Project

### Development Mode

```bash
npm run dev
```

This starts the server with hot-reload using `ts-node-dev`.

### Production Mode

```bash
# Build the project
npm run build

# Start the server
npm start
```

### Type Checking

```bash
npm run type-check
```

### Linting

```bash
npm run lint
```

## 🗄 Database Setup

This project uses Supabase (PostgreSQL) as the database.

### Supabase Configuration

1. Create a new Supabase project
2. Set up Row Level Security (RLS) policies as needed
3. Configure JWT expiration in Supabase Dashboard:
   - Go to Authentication > Settings > JWT Settings
   - Set JWT expiration to 30 days (2592000 seconds) for better user experience

## 🔗 Services Integration

### Supabase

- Used for user authentication and database operations
- Service role key is required for backend operations
- Ensure RLS policies are configured correctly

### Firebase Cloud Messaging (FCM)

- Used for push notifications
- Requires Firebase Admin SDK credentials
- Supports Android, iOS, and Web platforms
- Timezone-aware notification delivery

## 🤖 SODA Model Integration

The project includes a Python Flask service for pronunciation analysis:

### Setup

1. Navigate to the SODA_model directory:
```bash
cd SODA_model
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Run the Flask service:
```bash
python app.py
```

The SODA model provides:
- Pronunciation accuracy analysis
- Phoneme detection
- Error type classification
- Severity scoring
- Therapy level recommendations

### Integration

The backend can integrate with the SODA model by making HTTP requests to the Flask service endpoint `/analyze` with audio files and expected text.

## 📝 Notes

- The AI service currently uses mock analysis for speech evaluation. Replace with actual AI service integration as needed.
- Notification scheduler runs every 5 minutes to check for scheduled notifications.
- All authenticated routes require a valid JWT token in the `Authorization` header: `Bearer <token>`
- File uploads are limited by Multer configuration (check `src/middleware/upload.ts`)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 📄 License

ISC

## 👥 Authors

Teratalk Development Team

---

For more information, please contact the development team.
