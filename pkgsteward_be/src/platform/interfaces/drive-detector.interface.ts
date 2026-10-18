export const DRIVE_DETECTOR = Symbol('DRIVE_DETECTOR');

export interface IDriveDetector {
  /** Gốc các ổ đĩa cố định (DriveType=3) dạng "C:\\", đã sắp xếp, không trùng. */
  listFixedDrives(): Promise<string[]>;
}
