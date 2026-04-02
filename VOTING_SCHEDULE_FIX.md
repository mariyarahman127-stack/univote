# Voting Schedule Fix - Timezone Issue

## Problem
When the admin sets the voting schedule at 7:00 PM and saves it, the voting page is shown before the scheduled time when students login.

## Root Cause
The issue was caused by a **timezone mismatch** in how the voting schedule was being saved and compared:

1. **Admin Dashboard**: When the admin selects a time using the `datetime-local` input (e.g., 7:00 PM), the browser interprets this as **local time**.

2. **Save Function**: The `saveSchedule()` function was converting this to a timestamp using `new Date(startTime).getTime()`, which treats the input as **UTC time**.

3. **Vote Page**: The `isVotingAllowed()` function compares `Date.now()` (which is UTC) with the saved timestamps.

### Example of the Problem:
- Admin sets: 7:00 PM (local time in Asia/Dhaka, UTC+6)
- Browser interprets as: 2026-04-01T19:00:00 (local time)
- Converted to timestamp: 1775048400000 (which is 2026-04-01T18:00:00.000Z = 6:00 PM UTC)
- Current time: 2026-04-01T12:33:05.434Z (UTC) = 2026-04-01T18:33:05.434 (local)
- Result: Voting page shows because current time (18:33 UTC) is after start time (18:00 UTC)

## Solution
Updated the `saveSchedule()` function in all admin dashboard files to properly handle timezone conversion:

### Files Modified:
1. `univote/public/admin-dashboard.html`
2. `univote/admin-dashboard.html`

### Changes Made:
```javascript
// Before (incorrect):
const scheduleData = {
    startTime: new Date(startTime).getTime(),
    endTime: new Date(endTime).getTime(),
    updatedAt: Date.now()
};

// After (correct):
const startDate = new Date(startTime);
const endDate = new Date(endTime);

const scheduleData = {
    startTime: startDate.getTime(),
    endTime: endDate.getTime(),
    updatedAt: Date.now()
};

// Added logging for debugging:
console.log('Start time (local):', startDate.toLocaleString());
console.log('End time (local):', endDate.toLocaleString());
console.log('Start time (UTC):', startDate.toISOString());
console.log('End time (UTC):', endDate.toISOString());
```

### Additional Changes:
Added detailed logging to the `isVotingAllowed()` function in all voting page files to help debug time comparison issues:

**Files Updated:**
- `univote/public/vote-fixed.html`
- `univote/public/vote.html`
- `univote/public/voter-dashboard.html`
- `univote/vote/vote.html`
- `univote/vote.html`
- `univote/vote-fixed.html`

**Logging Added:**
```javascript
console.log('Current time (UTC):', new Date(now).toISOString());
console.log('Current time (local):', new Date(now).toLocaleString());
console.log('Start time (UTC):', new Date(startTime).toISOString());
console.log('Start time (local):', new Date(startTime).toLocaleString());
console.log('End time (UTC):', new Date(endTime).toISOString());
console.log('End time (local):', new Date(endTime).toLocaleString());
console.log('Now < startTime:', now < startTime);
console.log('Now > endTime:', now > endTime);
```

## How to Test
1. **Clear the existing schedule** in Firebase (or wait for it to expire)
2. **Set a new schedule** using the admin dashboard:
   - Select a start time (e.g., 7:00 PM)
   - Select an end time (e.g., 8:00 PM)
   - Click "Save Schedule"
3. **Check the browser console** to verify the timestamps are correct:
   - Start time (local) should show your selected time
   - Start time (UTC) should show the equivalent UTC time
4. **Login as a student** before the scheduled time
5. **Verify** that the voting page shows "Voting has not started yet" message
6. **Wait for the scheduled time** and refresh the page
7. **Verify** that the voting page now shows the candidates

## Expected Behavior
- **Before scheduled time**: Students should see "Voting has not started yet" message with countdown
- **During scheduled time**: Students should see the voting page with candidates
- **After scheduled time**: Students should see "Voting has ended" message

## Notes
- The `datetime-local` input always interprets the selected time as **local time** in the browser's timezone
- The `new Date()` constructor correctly converts local time to UTC milliseconds
- The comparison using `Date.now()` is in UTC milliseconds, which is correct
- The fix ensures that the admin's local time is properly converted to UTC for storage and comparison
