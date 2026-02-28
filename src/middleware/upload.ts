import multer from 'multer';
import { Request } from 'express';

/// Configure multer for M4A file uploads
/// Files are stored in memory for processing (not saved to disk)
const storage = multer.memoryStorage();

/// File filter to only accept M4A audio files
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // Accept M4A files and other common audio formats for flexibility
  const allowedMimeTypes = [
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/mpeg',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    'application/ogg',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`
      )
    );
  }
};

/// Multer configuration
export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
});

/// Middleware for single audio file upload
export const uploadAudio = upload.single('audio');

