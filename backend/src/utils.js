/**
 * Utility functions for StaffTrack backend
 */

/**
 * Format a date to YYYY-MM-DD
 */
export function formatDate(date) {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

// ── Date validation helpers ──────────────────────────────────────────────────
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a date string is in YYYY-MM-DD format
 * @param {string} dateStr - The date string to validate
 * @param {string} fieldName - Field name for error messages
 * @returns {string|null} - Error message or null if valid
 */
export function validateDateFormat(dateStr, fieldName) {
    if (!dateStr) return null; // null/empty is valid (optional field)
    if (!DATE_REGEX.test(dateStr)) {
        return `${fieldName} must be in YYYY-MM-DD format`;
    }
    // Additional check: ensure it's a valid date
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
        return `${fieldName} is not a valid date`;
    }
    return null;
}

/**
 * Validate date range (end >= start)
 * @param {string} startDate - Start date string
 * @param {string} endDate - End date string
 * @param {string} startFieldName - Start field name for error
 * @param {string} endFieldName - End field name for error
 * @returns {string|null} - Error message or null if valid
 */
export function validateDateRange(startDate, endDate, startFieldName = 'Start date', endFieldName = 'End date') {
    if (startDate && endDate && startDate > endDate) {
        return `${endFieldName} must be on or after ${startFieldName.toLowerCase()}`;
    }
    return null;
}

/**
 * Sleep for ms milliseconds
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
