  // ==========================================
  // CONSTANTS
  // ==========================================
  const STORAGE_KEY = 'periodTrackerData';
  // Minimum surviving start-to-start intervals needed for a real cycle average.
  // Equivalent to the old "3 completed periods" rule when no cycles are skipped.
  const MIN_INTERVALS_FOR_CYCLE_AVG = 2;
  // Minimum bleeding periods needed for a real period-length average.
  const MIN_BLEED_SAMPLES_FOR_PERIOD_AVG = 3;
  const APP_VERSION = '__VERSION__';

  // ==========================================
  // DEFAULT DATA
  // ==========================================
  const defaultData = {
    periods: [],
    settings: {
      defaultCycleLength: 28,
      defaultPeriodLength: 5
    }
  };

  // ==========================================
  // STORAGE UTILITIES
  // ==========================================

  /**
   * Load data from localStorage or return default
   * @returns {Object} App data
   */
  function loadData() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle any missing keys
        return { ...defaultData, ...parsed };
      }
    } catch (e) {
      console.error('Error loading data:', e);
    }
    return { ...defaultData };
  }

  /**
   * Save data to localStorage (internal)
   * @param {Object} data - App data to save
   */
  function saveDataImmediate(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Error saving data:', e);
    }
  }

  /**
   * Debounced save - prevents excessive writes during rapid changes
   */
  const saveDataDebounced = debounce(saveDataImmediate, 300);

  /**
   * Save data to localStorage (debounced for performance)
   * @param {Object} data - App data to save
   */
  function saveData(data) {
    saveDataDebounced(data);
  }

  // ==========================================
  // DARK MODE
  // ==========================================
  const THEME_KEY = 'periodTrackerTheme';

  /**
   * Get the current theme preference
   * @returns {string} 'light', 'dark', or 'system'
   */
  function getThemePreference() {
    return localStorage.getItem(THEME_KEY) || 'system';
  }

  /**
   * Set theme preference
   * @param {string} theme - 'light', 'dark', or 'system'
   */
  function setThemePreference(theme) {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme();
  }

  /**
   * Check if system prefers dark mode
   * @returns {boolean}
   */
  function systemPrefersDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Apply the current theme to the document
   */
  function applyTheme() {
    const preference = getThemePreference();
    const shouldBeDark = preference === 'dark' || (preference === 'system' && systemPrefersDark());

    if (shouldBeDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  /**
   * Apply the current phase color scheme to the body
   */
  function applyPhaseColors(data) {
    const phase = getCurrentPhase(data);
    const phaseClasses = ['phase-menstrual', 'phase-follicular', 'phase-ovulation', 'phase-luteal-early', 'phase-luteal-late'];

    // Remove all phase classes
    document.body.classList.remove(...phaseClasses);

    // Add current phase class (default to menstrual if no data)
    if (phase) {
      document.body.classList.add(`phase-${phase.id}`);
    } else {
      // Default to menstrual colors when no cycle data exists
      document.body.classList.add('phase-menstrual');
    }
  }

  /**
   * Toggle between light and dark (sets explicit preference)
   */
  function toggleTheme() {
    const preference = getThemePreference();
    const currentlyDark = document.documentElement.classList.contains('dark');

    // If on system, switch to explicit opposite
    // If on explicit, toggle to other explicit
    if (currentlyDark) {
      setThemePreference('light');
    } else {
      setThemePreference('dark');
    }

    // Re-render to update icon
    render();
  }

  // Apply theme immediately to prevent flash
  applyTheme();

  // Apply phase colors immediately (default to menstrual if no data)
  document.body.classList.add('phase-menstrual');

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePreference() === 'system') {
      applyTheme();
      render();
    }
  });

  // ==========================================
  // PERFORMANCE UTILITIES
  // ==========================================

  /**
   * Debounce function to limit rapid calls
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Cache for expensive calculations
   */
  const calculationCache = {
    data: null,
    avgCycle: null,
    avgPeriod: null,
    cycleDay: null,
    phase: null,

    invalidate() {
      this.data = null;
      this.avgCycle = null;
      this.avgPeriod = null;
      this.cycleDay = null;
      this.phase = null;
    },

    isValid(data) {
      return this.data === JSON.stringify(data.periods);
    },

    update(data) {
      this.data = JSON.stringify(data.periods);
    }
  };

  /**
   * Drop every cached value when the data changes.
   *
   * Clearing only the field being read would leave the others keyed to data
   * they were not computed from, so the next reader gets a stale answer for
   * the new dataset.
   */
  function ensureCacheFresh(data) {
    if (!calculationCache.isValid(data)) {
      calculationCache.invalidate();
      calculationCache.update(data);
    }
  }

  /**
   * Get cached or calculate average cycle length
   */
  function getCachedAverageCycleLength(data) {
    if (isDebugActive()) return debugMode.cycleLength;

    ensureCacheFresh(data);

    if (calculationCache.avgCycle === null) {
      calculationCache.avgCycle = calculateAverageCycleLength(data);
    }
    return calculationCache.avgCycle;
  }

  /**
   * Get cached or calculate average period length
   */
  function getCachedAveragePeriodLength(data) {
    if (isDebugActive()) return debugMode.periodLength;

    ensureCacheFresh(data);

    if (calculationCache.avgPeriod === null) {
      calculationCache.avgPeriod = calculateAveragePeriodLength(data);
    }
    return calculationCache.avgPeriod;
  }

  // ==========================================
  // UI CONSTANTS & HELPERS
  // ==========================================

  /**
   * Common CSS class strings to reduce duplication
   */
  const UI = {
    // Text styles
    text: {
      heading: 'font-display text-lg text-stone-700 dark:text-stone-200',
      body: 'text-stone-500 dark:text-stone-400 text-sm',
      small: 'text-xs text-stone-500 dark:text-stone-400',
    },
    // Button styles
    btn: {
      primary: 'py-3 px-4 rounded-xl text-white font-medium transition-colors',
      secondary: 'py-3 px-4 rounded-xl bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-200 font-medium hover:bg-stone-200 dark:hover:bg-stone-600 transition-colors',
      danger: 'py-3 px-4 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors',
      icon: 'p-1.5 rounded-full text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-white/50 dark:hover:bg-stone-700 transition-all duration-150',
    },
    // Input styles
    input: 'w-full px-4 py-3 rounded-xl border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-700 text-stone-700 dark:text-stone-200 focus:outline-hidden focus:border-stone-500 dark:focus:border-stone-400',
    // Modal styles
    modal: {
      overlay: 'fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-5',
      container: 'bg-white dark:bg-stone-800 rounded-2xl p-6 max-w-sm w-full shadow-xl',
    },
    // Card styles
    card: 'phase-card backdrop-blur-xs rounded-2xl p-5',
  };

  /**
   * SVG Icons used throughout the app
   */
  const ICONS = {
    logo: `<svg width="32" height="32" viewBox="0 0 64 64" fill="none">
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="var(--phase-gradient-from, #f43f5e)"/>
            <stop offset="100%" stop-color="var(--phase-gradient-to, #7c3aed)"/>
          </linearGradient>
          <filter id="starGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <circle cx="46" cy="12" r="2.5" fill="#fbbf24" filter="url(#starGlow)"/>
        <circle cx="54" cy="28" r="1.5" fill="#fbbf24" filter="url(#starGlow)"/>
        <circle cx="50" cy="42" r="2" fill="#fbbf24" filter="url(#starGlow)"/>
        <path d="M28 6C14.745 6 4 16.745 4 30s10.745 24 24 24c1.2 0 2.38-.09 3.52-.27C22.24 51.76 16 42.16 16 30S22.24 8.24 31.52 6.27C30.38 6.09 29.2 6 28 6z" fill="url(#logoGradient)"/>
      </svg>`,
    sun: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>`,
    moon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>`,
    edit: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>`,
    trash: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>`,
    plus: `<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
      </svg>`,
  };

  /**
   * Create a modal with standard styling
   * @param {string} id - Modal ID
   * @param {string} content - Modal inner HTML content
   * @returns {HTMLElement} Modal element
   */
  function createModal(id, content) {
    const modal = document.createElement('div');
    modal.id = id;
    modal.innerHTML = `
        <div id="${id}Overlay" class="${UI.modal.overlay}">
          <div class="${UI.modal.container}">
            ${content}
          </div>
        </div>
      `;
    return modal;
  }

  /**
   * Remove a modal by ID
   * @param {string} id - Modal ID
   */
  function removeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.remove();
  }

  // ==========================================
  // ID GENERATION
  // ==========================================

  /**
   * Generate a simple unique ID
   * @returns {string} Unique identifier
   */
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  // ==========================================
  // DATE UTILITIES
  // ==========================================

  /**
   * Get today's date as ISO string (YYYY-MM-DD)
   * @returns {string} Today's date
   */
  function getTodayString() {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Parse an ISO date string to a Date object (at midnight local time)
   * @param {string} dateStr - ISO date string
   * @returns {Date} Date object
   */
  function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  /**
   * Calculate days between two dates
   * @param {string} date1 - ISO date string
   * @param {string} date2 - ISO date string
   * @returns {number} Number of days between dates
   */
  function daysBetween(date1, date2) {
    const d1 = parseDate(date1);
    const d2 = parseDate(date2);
    const diffTime = Math.abs(d2 - d1);
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Add days to a date string
   * @param {string} dateStr - ISO date string
   * @param {number} days - Number of days to add
   * @returns {string} New ISO date string
   */
  function addDays(dateStr, days) {
    const date = parseDate(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Format a date for display
   * @param {string} dateStr - ISO date string
   * @returns {string} Formatted date (e.g., "Jan 15")
   */
  function formatDate(dateStr) {
    const date = parseDate(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ==========================================
  // PERIOD MANAGEMENT
  // ==========================================

  /**
   * Check whether a record is a skipped-cycle marker rather than real bleeding
   * @param {Object} period - Period object
   * @returns {boolean} True if the cycle was logged as skipped
   */
  function isSkip(period) {
    return period.skipped === true;
  }

  /**
   * Check whether a record represents an actual bleeding period.
   * Absence of the flag means bleeding, so records predating this feature
   * read correctly with no migration.
   * @param {Object} period - Period object
   * @returns {boolean} True if bleeding occurred
   */
  function isBleeding(period) {
    return !period.skipped;
  }

  /**
   * Check if there's currently an ongoing period
   * @param {Object} data - App data
   * @returns {boolean} True if on period
   */
  function isOnPeriod(data) {
    // In debug mode, calculate based on debug values
    if (isDebugActive()) {
      return debugMode.cycleDay <= debugMode.periodLength;
    }
    return data.periods.some(p => p.endDate === null);
  }

  /**
   * Get the current ongoing period (most recent one if multiple exist)
   * @param {Object} data - App data
   * @returns {Object|null} Current period or null
   */
  function getCurrentPeriod(data) {
    const ongoingPeriods = data.periods.filter(p => p.endDate === null);
    if (ongoingPeriods.length === 0) return null;

    // Return the most recent one by start date
    return ongoingPeriods.sort((a, b) =>
            parseDate(b.startDate) - parseDate(a.startDate)
    )[0];
  }

  /**
   * Get all completed periods sorted by start date (newest first)
   * @param {Object} data - App data
   * @returns {Array} Completed periods
   */
  function getCompletedPeriods(data) {
    return data.periods
            .filter(p => p.endDate !== null)
            .sort((a, b) => parseDate(b.startDate) - parseDate(a.startDate));
  }

  /**
   * Get completed periods where bleeding actually occurred, newest first.
   * Skipped-cycle markers carry no bleed duration, so they are excluded.
   * @param {Object} data - App data
   * @returns {Array} Completed bleeding periods
   */
  function getBleedSamples(data) {
    return getCompletedPeriods(data).filter(isBleeding);
  }

  /**
   * Get start-to-start intervals that are safe to average.
   *
   * An interval only survives if neither of its endpoints is a skipped-cycle
   * marker. A gap spanning a skip tells us nothing about cycle length, so it
   * is voided rather than counted whole or split into invented halves.
   *
   * @param {Object} data - App data
   * @returns {Array<number>} Surviving interval lengths in days
   */
  function getSurvivingIntervals(data) {
    const sorted = [...getCompletedPeriods(data)].sort((a, b) =>
            parseDate(a.startDate) - parseDate(b.startDate)
    );

    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      if (isSkip(sorted[i - 1]) || isSkip(sorted[i])) continue;
      intervals.push(getCycleLength(sorted[i - 1], sorted[i]));
    }
    return intervals;
  }

  /**
   * Get the most recent period (completed or ongoing)
   * @param {Object} data - App data
   * @returns {Object|null} Most recent period or null
   */
  function getMostRecentPeriod(data) {
    if (data.periods.length === 0) return null;
    return [...data.periods].sort((a, b) =>
            parseDate(b.startDate) - parseDate(a.startDate)
    )[0];
  }

  /**
   * Start a new period
   * @param {Object} data - App data
   * @param {string} date - Start date (defaults to today)
   * @returns {Object} Updated data
   */
  function startPeriod(data, date = getTodayString()) {
    // Don't start if already on period
    if (isOnPeriod(data)) {
      console.warn('Already on period');
      return data;
    }

    const newPeriod = {
      id: generateId(),
      startDate: date,
      endDate: null
    };

    return {
      ...data,
      periods: [...data.periods, newPeriod]
    };
  }

  /**
   * End the current period
   * @param {Object} data - App data
   * @param {string} date - End date (defaults to today)
   * @returns {Object} Updated data
   */
  function endPeriod(data, date = getTodayString()) {
    const currentPeriod = getCurrentPeriod(data);

    if (!currentPeriod) {
      console.warn('No active period to end');
      return data;
    }

    // Ensure end date is not before start date
    if (parseDate(date) < parseDate(currentPeriod.startDate)) {
      console.warn('End date cannot be before start date');
      return data;
    }

    return {
      ...data,
      periods: data.periods.map(p =>
              p.id === currentPeriod.id
                      ? { ...p, endDate: date }
                      : p
      )
    };
  }

  /**
   * Delete a period by ID
   * @param {Object} data - App data
   * @param {string} periodId - ID of period to delete
   * @returns {Object} Updated data
   */
  function deletePeriod(data, periodId) {
    return {
      ...data,
      periods: data.periods.filter(p => p.id !== periodId)
    };
  }

  /**
   * Add a completed historical period
   * @param {Object} data - App data
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @returns {Object} Updated data
   */
  function addPastPeriod(data, startDate, endDate) {
    const newPeriod = {
      id: generateId(),
      startDate,
      endDate
    };
    return {
      ...data,
      periods: [...data.periods, newPeriod]
    };
  }

  /**
   * Update a period's start date
   * @param {Object} data - App data
   * @param {string} periodId - ID of period to update
   * @param {string} newStartDate - New start date
   * @returns {Object} Updated data
   */
  function updatePeriodStartDate(data, periodId, newStartDate) {
    return {
      ...data,
      periods: data.periods.map(p =>
              p.id === periodId
                      ? { ...p, startDate: newStartDate }
                      : p
      )
    };
  }

  /**
   * Update a period's end date
   * @param {Object} data - App data
   * @param {string} periodId - ID of period to update
   * @param {string} newEndDate - New end date
   * @returns {Object} Updated data
   */
  function updatePeriodEndDate(data, periodId, newEndDate) {
    return {
      ...data,
      periods: data.periods.map(p =>
              p.id === periodId
                      ? { ...p, endDate: newEndDate }
                      : p
      )
    };
  }

  /**
   * Set or clear the skipped-cycle flag on a period.
   * Clearing removes the key entirely rather than storing false, so absence
   * stays the single meaning of "this was a real bleeding period".
   * @param {Object} data - App data
   * @param {string} periodId - ID of period to update
   * @param {boolean} skipped - Whether the cycle passed without bleeding
   * @returns {Object} Updated data
   */
  function updatePeriodSkipped(data, periodId, skipped) {
    return {
      ...data,
      periods: data.periods.map(p => {
        if (p.id !== periodId) return p;
        if (skipped) {
          // A skip is a single-day marker; there is no bleed duration to keep
          return { ...p, endDate: p.endDate || p.startDate, skipped: true };
        }
        const { skipped: _wasSkipped, ...rest } = p;
        return rest;
      })
    };
  }

  /**
   * Log a cycle that passed without bleeding.
   *
   * The marker lands on the predicted start date rather than today, so a user
   * who logs late does not drag the whole grid along with them. Calling this
   * repeatedly chains naturally when several cycles in a row were missed.
   *
   * @param {Object} data - App data
   * @returns {Object} Updated data
   */
  function logSkippedCycle(data) {
    const markerDate = predictNextPeriodStart(data);
    if (!markerDate) return data;

    return {
      ...data,
      periods: [...data.periods, {
        id: generateId(),
        startDate: markerDate,
        endDate: markerDate,
        skipped: true
      }]
    };
  }

  // ==========================================
  // CYCLE CALCULATIONS
  // ==========================================

  /**
   * Calculate cycle length between two periods (start to start)
   * @param {Object} period1 - Earlier period
   * @param {Object} period2 - Later period
   * @returns {number} Cycle length in days
   */
  function getCycleLength(period1, period2) {
    return daysBetween(period1.startDate, period2.startDate);
  }

  /**
   * Get period duration in days
   * @param {Object} period - Period object
   * @returns {number} Duration in days (returns 0 if ongoing)
   */
  function getPeriodLength(period) {
    if (!period.endDate) return 0;
    return daysBetween(period.startDate, period.endDate) + 1; // +1 to include both start and end day
  }

  /**
   * Calculate average cycle length (internal - use getCachedAverageCycleLength)
   * @param {Object} data - App data
   * @returns {number} Average cycle length
   */
  function calculateAverageCycleLength(data) {
    const intervals = getSurvivingIntervals(data);

    // Skips void the intervals around them, so a user with several skipped
    // cycles can drop below the threshold and fall back to the default.
    if (intervals.length < MIN_INTERVALS_FOR_CYCLE_AVG) {
      return data.settings.defaultCycleLength;
    }

    const sum = intervals.reduce((a, b) => a + b, 0);
    return Math.round(sum / intervals.length);
  }

  /**
   * Get average cycle length (cached)
   * @param {Object} data - App data
   * @returns {number} Average cycle length
   */
  function getAverageCycleLength(data) {
    return getCachedAverageCycleLength(data);
  }

  /**
   * Calculate average period length (internal - use getAveragePeriodLength)
   * @param {Object} data - App data
   * @returns {number} Average period length
   */
  function calculateAveragePeriodLength(data) {
    const samples = getBleedSamples(data);

    if (samples.length < MIN_BLEED_SAMPLES_FOR_PERIOD_AVG) {
      return data.settings.defaultPeriodLength;
    }

    const lengths = samples.map(getPeriodLength).filter(l => l > 0);
    if (lengths.length === 0) return data.settings.defaultPeriodLength;

    const sum = lengths.reduce((a, b) => a + b, 0);
    return Math.round(sum / lengths.length);
  }

  /**
   * Get average period length (cached)
   * @param {Object} data - App data
   * @returns {number} Average period length
   */
  function getAveragePeriodLength(data) {
    return getCachedAveragePeriodLength(data);
  }

  /**
   * Get current cycle day (days since last period started)
   * @param {Object} data - App data
   * @returns {number|null} Current cycle day or null if no periods
   */
  function getCurrentCycleDay(data) {
    // Debug override for testing
    if (isDebugActive()) {
      return debugMode.cycleDay;
    }

    const mostRecent = getMostRecentPeriod(data);
    if (!mostRecent) return null;

    return daysBetween(mostRecent.startDate, getTodayString()) + 1; // +1 because day 1 is start day
  }

  /**
   * Predict next period start date
   * @param {Object} data - App data
   * @returns {string|null} Predicted start date or null if no data
   */
  function predictNextPeriodStart(data) {
    const mostRecent = getMostRecentPeriod(data);
    if (!mostRecent) return null;

    const avgCycle = getAverageCycleLength(data);
    return addDays(mostRecent.startDate, avgCycle);
  }

  /**
   * Get days until next predicted period
   * @param {Object} data - App data
   * @returns {number|null} Days until next period or null
   */
  function getDaysUntilNextPeriod(data) {
    // Debug override
    if (isDebugActive()) {
      return debugMode.cycleLength - debugMode.cycleDay;
    }

    const predictedStart = predictNextPeriodStart(data);
    if (!predictedStart) return null;

    const days = daysBetween(getTodayString(), predictedStart);
    const predicted = parseDate(predictedStart);
    const today = parseDate(getTodayString());

    // Return negative if predicted date is in the past
    return predicted >= today ? days : -days;
  }

  /**
   * Check whether the cycle-length average rests on real observations.
   * Separate from hasPeriodData because the two averages consume different
   * inputs: skips destroy interval data but leave bleed durations intact.
   * @param {Object} data - App data
   * @returns {boolean} True if enough surviving intervals exist
   */
  function hasCycleData(data) {
    return getSurvivingIntervals(data).length >= MIN_INTERVALS_FOR_CYCLE_AVG;
  }

  /**
   * Check whether the period-length average rests on real observations
   * @param {Object} data - App data
   * @returns {boolean} True if enough bleeding periods exist
   */
  function hasPeriodData(data) {
    return getBleedSamples(data).length >= MIN_BLEED_SAMPLES_FOR_PERIOD_AVG;
  }

  // ==========================================
  // CYCLE PHASES
  // ==========================================

  const CYCLE_PHASES = [
    {
      id: 'menstrual',
      name: 'Period',
      scientificName: 'Menstrual Phase',
      icon: '🩸',
      note: 'You may feel tired or withdrawn. Cramps and low energy are common.',
      color: 'rose-500',
      darkColor: 'rose-400'
    },
    {
      id: 'follicular',
      name: 'Rising Energy',
      scientificName: 'Follicular Phase',
      icon: '✨',
      note: 'Energy and mood often start to lift. You may feel more motivated and optimistic.',
      color: 'amber-500',
      darkColor: 'amber-400'
    },
    {
      id: 'ovulation',
      name: 'Peak',
      scientificName: 'Ovulatory Phase',
      icon: '🌟',
      note: 'Many feel their most confident and social. Mood and energy tend to peak.',
      color: 'emerald-500',
      darkColor: 'emerald-400'
    },
    {
      id: 'luteal-early',
      name: 'Winding Down',
      scientificName: 'Early Luteal Phase',
      icon: '🍃',
      note: 'A calm, focused stretch for many. Energy is often stable but starting to shift.',
      color: 'sky-500',
      darkColor: 'sky-400'
    },
    {
      id: 'luteal-late',
      name: 'Pre-Period',
      scientificName: 'Late Luteal Phase',
      icon: '🌙',
      note: 'Mood swings, cravings, or fatigue may appear. This is normal and temporary.',
      color: 'violet-500',
      darkColor: 'violet-400'
    }
  ];

  /**
   * Get the current cycle phase based on cycle day and average lengths
   * @param {Object} data - App data
   * @returns {Object|null} Current phase object or null if no data
   */
  function getCurrentPhase(data) {
    const cycleDay = getCurrentCycleDay(data);
    if (cycleDay === null) return null;

    const avgCycle = getAverageCycleLength(data);
    const avgPeriod = getAveragePeriodLength(data);

    // Luteal phase is relatively fixed at ~14 days
    // Work backwards from expected period to calculate phases
    const lutealLength = 14;
    const ovulationDay = avgCycle - lutealLength; // When ovulation occurs

    // Check if currently on period (override other calculations)
    if (isOnPeriod(data)) {
      return CYCLE_PHASES[0]; // Menstrual
    }

    // Use the actual length of the most recent period if it has ended,
    // so a shorter-than-average period doesn't keep showing as Menstrual phase
    // A skipped cycle has no menstrual phase - nothing bled - so day 1 falls
    // straight through to follicular instead of claiming Period.
    const mostRecent = getMostRecentPeriod(data);
    const periodEnd = (mostRecent && isSkip(mostRecent))
      ? 0
      : (mostRecent && mostRecent.endDate)
        ? getPeriodLength(mostRecent)
        : avgPeriod;

    // Phase boundaries
    const follicularEnd = ovulationDay - 1;        // Day before ovulation
    const ovulationEnd = ovulationDay + 2;         // Ovulation window ~3 days
    const lutealEarlyEnd = avgCycle - 5;           // ~5 days before period

    if (cycleDay <= periodEnd) {
      return CYCLE_PHASES[0]; // Menstrual
    } else if (cycleDay <= follicularEnd) {
      return CYCLE_PHASES[1]; // Follicular
    } else if (cycleDay <= ovulationEnd) {
      return CYCLE_PHASES[2]; // Ovulation
    } else if (cycleDay <= lutealEarlyEnd) {
      return CYCLE_PHASES[3]; // Luteal Early
    } else {
      return CYCLE_PHASES[4]; // Luteal Late / PMS
    }
  }

  /**
   * Get phase boundaries for timeline display
   * @param {Object} data - App data
   * @returns {Array} Array of phase objects with start/end percentages
   */
  function getPhaseBoundaries(data) {
    const avgCycle = getAverageCycleLength(data);
    const avgPeriod = getAveragePeriodLength(data);

    // Luteal phase is relatively fixed at ~14 days
    const lutealLength = 14;
    const ovulationDay = avgCycle - lutealLength;

    // Same skip guard as getCurrentPhase, so the timeline band and the phase
    // card agree rather than putting the marker in a rose band we deny exists
    const mostRecent = getMostRecentPeriod(data);
    const periodEnd = (mostRecent && isSkip(mostRecent)) ? 0 : avgPeriod / avgCycle;
    const follicularEnd = (ovulationDay - 1) / avgCycle;
    const ovulationEnd = (ovulationDay + 2) / avgCycle;
    const lutealEarlyEnd = (avgCycle - 5) / avgCycle;

    return [
      { ...CYCLE_PHASES[0], start: 0, end: periodEnd },
      { ...CYCLE_PHASES[1], start: periodEnd, end: follicularEnd },
      { ...CYCLE_PHASES[2], start: follicularEnd, end: ovulationEnd },
      { ...CYCLE_PHASES[3], start: ovulationEnd, end: lutealEarlyEnd },
      { ...CYCLE_PHASES[4], start: lutealEarlyEnd, end: 1 }
    ];
  }

  // ==========================================
  // DATA MANAGEMENT
  // ==========================================

  /**
   * Export app data as a downloadable JSON file
   */
  function exportData(data) {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: data
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cycle-backup-${getTodayString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Parse and validate an imported JSON string
   * @returns {{ ok: true, data: Object } | { ok: false, error: string }}
   */
  function parseImportFile(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      return { ok: false, error: 'File is not valid JSON.' };
    }

    // Support both wrapped format (version 1) and bare data object
    const data = parsed.version === 1 ? parsed.data : parsed;

    if (!data || !Array.isArray(data.periods)) {
      return { ok: false, error: 'File does not appear to be a Cycle backup.' };
    }

    // Validate period entries
    for (const p of data.periods) {
      if (typeof p.id !== 'string' || typeof p.startDate !== 'string') {
        return { ok: false, error: 'Backup contains invalid period entries.' };
      }
    }

    // Ensure settings object exists, and normalise the skip flag so a
    // hand-edited file cannot smuggle in a truthy non-boolean
    const merged = {
      ...defaultData,
      ...data,
      periods: data.periods.map(p => {
        const { skipped, ...rest } = p;
        return skipped === true ? { ...rest, skipped: true } : rest;
      })
    };
    return { ok: true, data: merged };
  }

  /**
   * Clear all app data and reset to defaults
   */
  function clearAllData() {
    updateData({ ...defaultData });
  }

  // ==========================================
  // APP STATE
  // ==========================================
  let appData = loadData();

  // Debug mode state
  let debugMode = {
    enabled: false,
    cycleDay: null,
    cycleLength: 28,
    periodLength: 5
  };

  // Hidden debug panel state
  let debugPanelVisible = false;
  let debugTapCount = 0;
  let debugTapTimer = null;

  /**
   * Check if debug mode is active
   */
  function isDebugActive() {
    return debugMode.enabled && debugMode.cycleDay !== null;
  }

  /**
   * Update app data and re-render
   * @param {Object} newData - New app data
   */
  function updateData(newData) {
    appData = newData;
    calculationCache.invalidate(); // Clear cache when data changes
    saveData(appData);
    render();
  }

  // ==========================================
  // UI RENDERING
  // ==========================================

  /**
   * Main render function
   */
  function render() {
    const app = document.getElementById('app');

    // Apply phase-based colors
    applyPhaseColors(appData);

    const onPeriod = isOnPeriod(appData);
    const cycleDay = getCurrentCycleDay(appData);
    const daysUntil = getDaysUntilNextPeriod(appData);
    const avgCycle = getAverageCycleLength(appData);
    const mostRecent = getMostRecentPeriod(appData);
    const isDark = document.documentElement.classList.contains('dark');

    app.innerHTML = `
        <!-- Header -->
        <header class="flex items-center justify-between mb-10">
          <div class="w-10"></div>
          <div id="appTitle" class="flex items-center gap-2 select-none cursor-default">
            ${ICONS.logo}
            <h1 class="font-display text-2xl font-medium tracking-tight" style="color: var(--phase-accent-light);">Cycle</h1>
          </div>
          <button id="themeToggleBtn" class="w-10 h-10 flex items-center justify-center rounded-full text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors" aria-label="Toggle theme">
            ${isDark ? ICONS.sun : ICONS.moon}
          </button>
        </header>

        <!-- Main Status Card -->
        <div class="phase-card backdrop-blur-xs rounded-3xl p-8 mb-6">
          ${renderStatusContent(onPeriod, cycleDay, daysUntil, mostRecent)}
        </div>

        <!-- Action Button -->
        <div class="mb-8">
          ${renderActionButton(onPeriod)}
        </div>

        <!-- Stats -->
        ${renderStats(avgCycle, appData)}

        <!-- Period History -->
        ${renderHistory(appData)}

        <!-- Data Management -->
        ${renderDataManagement(appData)}

        <!-- Debug Panel -->
        ${debugPanelVisible ? renderDebugPanel(appData) : ''}
      `;
  }

  /**
   * Render debug panel for testing phases
   */
  function renderDebugPanel(data) {
    const avgCycle = isDebugActive() ? debugMode.cycleLength : getAverageCycleLength(data);
    const avgPeriod = isDebugActive() ? debugMode.periodLength : getAveragePeriodLength(data);
    const currentDay = isDebugActive() ? debugMode.cycleDay : (getCurrentCycleDay(data) || 1);

    return `
        <div class="mt-8 bg-stone-100 dark:bg-stone-800 rounded-2xl p-5 border-2 border-dashed border-stone-300 dark:border-stone-600">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-medium text-stone-700 dark:text-stone-200 text-sm">🧪 Debug Mode</h3>
            <div class="flex items-center gap-3">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="debugToggle"
                  ${debugMode.enabled ? 'checked' : ''}
                  class="w-4 h-4 accent-rose-500"
                >
                <span class="text-xs text-stone-500 dark:text-stone-400">Enable</span>
              </label>
              <button id="debugResetBtn" class="text-xs text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 font-medium">
                Reset
              </button>
            </div>
          </div>

          <div class="space-y-5 ${debugMode.enabled ? '' : 'opacity-50 pointer-events-none'}">
            <!-- Cycle Length -->
            <div>
              <div class="flex justify-between text-xs text-stone-500 dark:text-stone-400 mb-2">
                <span>Cycle Length</span>
                <span class="font-medium text-stone-700 dark:text-stone-200">${avgCycle} days</span>
              </div>
              <input
                type="range"
                id="debugCycleLengthSlider"
                min="21"
                max="40"
                value="${avgCycle}"
                class="w-full h-2 bg-stone-200 dark:bg-stone-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
              >
              <div class="flex justify-between text-xs text-stone-500 dark:text-stone-400 mt-1">
                <span>21</span>
                <span>40</span>
              </div>
            </div>

            <!-- Period Length -->
            <div>
              <div class="flex justify-between text-xs text-stone-500 dark:text-stone-400 mb-2">
                <span>Period Length</span>
                <span class="font-medium text-stone-700 dark:text-stone-200">${avgPeriod} days</span>
              </div>
              <input
                type="range"
                id="debugPeriodLengthSlider"
                min="2"
                max="10"
                value="${avgPeriod}"
                class="w-full h-2 bg-stone-200 dark:bg-stone-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
              >
              <div class="flex justify-between text-xs text-stone-500 dark:text-stone-400 mt-1">
                <span>2</span>
                <span>10</span>
              </div>
            </div>

            <!-- Current Day -->
            <div>
              <div class="flex justify-between text-xs text-stone-500 dark:text-stone-400 mb-2">
                <span>Current Cycle Day</span>
                <span class="font-medium text-stone-700 dark:text-stone-200">Day ${currentDay}</span>
              </div>
              <input
                type="range"
                id="debugDaySlider"
                min="1"
                max="${avgCycle + 10}"
                value="${currentDay}"
                class="w-full h-2 bg-stone-200 dark:bg-stone-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
              >
              <div class="flex justify-between text-xs text-stone-500 dark:text-stone-400 mt-1">
                <span>Day 1</span>
                <span>Day ${avgCycle + 10}</span>
              </div>
            </div>
          </div>
        </div>
      `;
  }

  /**
   * Render the main status content
   */
  function renderStatusContent(onPeriod, cycleDay, daysUntil, mostRecent) {
    if (!mostRecent) {
      return `
          <div class="text-center">
            <div class="w-28 h-28 mx-auto mb-6 rounded-full flex items-center justify-center phase-glow"
                 style="background: linear-gradient(to bottom right, var(--phase-gradient-from), var(--phase-gradient-to));">
              <span class="text-white">${ICONS.plus}</span>
            </div>
            <h2 class="${UI.text.heading} text-xl mb-2">Welcome</h2>
            <p class="${UI.text.body}">Your data stays on this device.<br>No account. No cloud. Just you.</p>
          </div>
        `;
    }

    if (onPeriod) {
      const current = getCurrentPeriod(appData);
      const dayCount = isDebugActive() ? debugMode.cycleDay : (current ? daysBetween(current.startDate, getTodayString()) + 1 : 1);
      const phase = CYCLE_PHASES[0]; // Menstrual phase
      const startedText = isDebugActive() ? 'Simulated period' : `Started ${formatDate(current.startDate)}`;

      return `
          <div class="text-center">
            <div class="w-32 h-32 mx-auto mb-6 rounded-full flex items-center justify-center phase-glow"
                 style="background: linear-gradient(145deg, var(--phase-gradient-from), var(--phase-gradient-to));">
              <span class="font-display text-4xl text-white font-medium">${dayCount}</span>
            </div>
            <h2 class="${UI.text.heading} text-xl mb-1">Day ${dayCount} of your period</h2>
            <div class="flex items-center justify-center gap-2">
              <p class="${UI.text.body}">${startedText}</p>
              ${!isDebugActive() ? `
                <button id="editPeriodStartBtn" class="hover:opacity-70" style="color: var(--phase-accent-light);" aria-label="Edit start date">
                  ${ICONS.edit}
                </button>
              ` : ''}
            </div>
            <div class="mt-6 pt-5 border-t" style="border-color: var(--phase-card-border);">
              <div class="flex items-center justify-center gap-2 mb-1">
                <span class="text-lg">${phase.icon}</span>
                <span class="font-medium text-stone-700 dark:text-stone-200">${phase.name}</span>
              </div>
              <p class="${UI.text.small} mb-2">${phase.scientificName}</p>
              <p class="${UI.text.body}">${phase.note.replace(/\. /g, '.<br>')}</p>
            </div>
            ${renderPhaseTimeline(appData)}
          </div>
        `;
    }

    // Not on period.
    // When the cycle gate fails the number rests on a default rather than on
    // observations, so the copy stops sounding equally sure of both.
    const cycleIsEstimate = !hasCycleData(appData);
    const arrival = cycleIsEstimate ? 'estimated' : 'may arrive';
    const daysText = daysUntil !== null
            ? (daysUntil > 0
                    ? `Next period ${arrival} in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`
                    : daysUntil === 0
                            ? (cycleIsEstimate ? 'Period estimated for today' : 'Period may arrive today')
                            : `Your period may arrive soon<br>(${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} past expected)`)
            : '';

    const estimateNote = (cycleIsEstimate && daysUntil !== null)
            ? `<p class="${UI.text.small} mt-1">based on a typical ${getAverageCycleLength(appData)}-day cycle</p>`
            : '';

    // Door 1: only offered once the predicted date has already passed, so the
    // marker logSkippedCycle places can never land in the future
    const skipPrompt = (daysUntil !== null && daysUntil < 0 && !isDebugActive())
            ? `<button id="logSkippedCycleBtn" class="mt-4 text-sm font-medium transition-colors hover:opacity-70 phase-text-accent">Period didn't arrive?</button>`
            : '';

    const phase = getCurrentPhase(appData);
    const phaseHtml = phase ? `
        <div class="mt-6 pt-5 border-t" style="border-color: var(--phase-card-border);">
          <div class="flex items-center justify-center gap-2 mb-1">
            <span class="text-lg">${phase.icon}</span>
            <span class="font-medium text-stone-700 dark:text-stone-200">${phase.name}</span>
          </div>
          <p class="${UI.text.small} mb-2">${phase.scientificName}</p>
          <p class="${UI.text.body}">${phase.note.replace(/\. /g, '.<br>')}</p>
        </div>
        ${renderPhaseTimeline(appData)}
      ` : '';

    return `
        <div class="text-center">
          <div class="w-32 h-32 mx-auto mb-6 rounded-full flex items-center justify-center phase-glow"
               style="background: linear-gradient(145deg, var(--phase-gradient-from), var(--phase-gradient-to));">
            <span class="font-display text-4xl text-white font-medium">${cycleDay || '—'}</span>
          </div>
          <h2 class="${UI.text.heading} text-xl mb-1">Day ${cycleDay || '—'} of your cycle</h2>
          <p class="${UI.text.body}">${daysText}</p>
          ${estimateNote}
          ${skipPrompt}
          ${phaseHtml}
        </div>
      `;
  }

  /**
   * Render the phase timeline
   */
  function renderPhaseTimeline(data) {
    const cycleDay = getCurrentCycleDay(data);
    if (cycleDay === null) return '';

    const avgCycle = getAverageCycleLength(data);
    const boundaries = getPhaseBoundaries(data);
    const progress = Math.min((cycleDay - 1) / avgCycle, 1);

    // Define colors for gradient (using hex values for CSS gradient)
    const phaseColors = {
      'menstrual': '#fb7185',     // rose-400
      'follicular': '#fbbf24',    // amber-400
      'ovulation': '#34d399',     // emerald-400
      'luteal-early': '#38bdf8',  // sky-400
      'luteal-late': '#a78bfa'    // violet-400
    };

    // Build gradient stops with smooth transitions
    // Each phase blends into the next over ~5% of the timeline
    const blendSize = 0.08; // 8% blend zone
    const gradientStops = [];
    
    boundaries.forEach((phase, index) => {
      const color = phaseColors[phase.id];
      const startPercent = phase.start * 100;
      const endPercent = phase.end * 100;
      
      if (index === 0) {
        // First phase: solid at start
        gradientStops.push(`${color} ${startPercent}%`);
      }
      
      // Solid color in the middle of the phase
      const solidStart = startPercent + (index > 0 ? blendSize * 100 : 0);
      const solidEnd = endPercent - (index < boundaries.length - 1 ? blendSize * 100 : 0);
      
      if (index > 0) {
        gradientStops.push(`${color} ${solidStart}%`);
      }
      
      if (index < boundaries.length - 1) {
        gradientStops.push(`${color} ${solidEnd}%`);
      } else {
        // Last phase: solid at end
        gradientStops.push(`${color} ${endPercent}%`);
      }
    });

    const gradient = `linear-gradient(to right, ${gradientStops.join(', ')})`;

    return `
        <div class="mt-5">
          <div class="relative">
            <div class="h-2 rounded-full overflow-hidden" style="background: ${gradient};"></div>
            <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full shadow-md border-2 border-white dark:border-stone-800" style="left: ${progress * 100}%; background-color: var(--phase-marker);"></div>
          </div>
          <div class="flex justify-between mt-2 text-xs text-stone-500 dark:text-stone-400">
            <span>Day 1</span>
            <span>Day ${avgCycle}</span>
          </div>
        </div>
      `;
  }

  /**
   * Render the action button
   */
  function renderActionButton(onPeriod) {
    if (onPeriod) {
      return `
          <button
            id="togglePeriodBtn"
            class="w-full py-4 px-6 rounded-2xl bg-white dark:bg-stone-800 border-2 border-stone-300 dark:border-stone-600 text-stone-700 dark:text-stone-200 font-medium
                   hover:bg-stone-50 dark:hover:bg-stone-700 active:scale-[0.98] transition-all duration-150"
          >
            End Period
          </button>
          <button
            id="logPastPeriodBtn"
            class="w-full mt-3 py-2 text-sm font-medium transition-colors hover:opacity-70 phase-text-accent"
          >
            + Log past period
          </button>
        `;
    }

    return `
        <button
          id="togglePeriodBtn"
          class="w-full py-4 px-6 rounded-2xl text-white font-medium shadow-lg active:scale-[0.98] transition-all duration-150"
          style="background: linear-gradient(to right, var(--phase-gradient-from), var(--phase-gradient-to));"
        >
          Start Period
        </button>
        <button
          id="logPastPeriodBtn"
          class="w-full mt-3 py-2 text-sm font-medium transition-colors hover:opacity-70 phase-text-accent"
        >
          + Log past period
        </button>
      `;
  }

  /**
   * Render stats section
   */
  function renderStats(avgCycle, data) {
    const completed = getCompletedPeriods(data);
    if (completed.length === 0) return '';

    const avgPeriod = getAveragePeriodLength(data);
    // Two gates: skips can starve the cycle average while leaving the
    // period-length average perfectly well supported
    const cycleIsEstimate = !hasCycleData(data);
    const periodIsEstimate = !hasPeriodData(data);
    const statLabel = 'text-stone-500 dark:text-stone-400 text-xs uppercase tracking-wide mb-1';
    const statValue = 'font-display text-2xl text-stone-700 dark:text-stone-200';

    return `
        <div class="grid grid-cols-2 gap-4 mb-8">
          <div class="${UI.card}">
            <p class="${statLabel}">Cycle Length</p>
            <p class="${statValue}">${avgCycle} <span class="text-base text-stone-500 dark:text-stone-400">days</span></p>
            ${cycleIsEstimate ? `<p class="${UI.text.small} mt-1" style="color: var(--phase-accent-light);">estimate</p>` : ''}
          </div>
          <div class="${UI.card}">
            <p class="${statLabel}">Period Length</p>
            <p class="${statValue}">${avgPeriod} <span class="text-base text-stone-500 dark:text-stone-400">days</span></p>
            ${periodIsEstimate ? `<p class="${UI.text.small} mt-1" style="color: var(--phase-accent-light);">estimate</p>` : ''}
          </div>
        </div>
      `;
  }

  /**
   * Render period history
   */
  function renderHistory(data) {
    const allPeriods = [...data.periods].sort((a, b) =>
            parseDate(b.startDate) - parseDate(a.startDate)
    );

    if (allPeriods.length === 0) return '';

    const historyItems = allPeriods.slice(0, 5).map(period => {
      const skipped = isSkip(period);
      const days = getPeriodLength(period);
      const duration = skipped
              ? 'no bleeding'
              : period.endDate
                      ? `${days} day${days !== 1 ? 's' : ''}`
                      : 'ongoing';

      return `
          <div class="flex items-center justify-between py-3 border-b last:border-0" style="border-color: var(--phase-card-border);">
            <div>
              <p class="text-stone-700 dark:text-stone-200 font-medium">${formatDate(period.startDate)}</p>
              <p class="${UI.text.body}">${duration}</p>
            </div>
            <div class="flex items-center gap-2">
              ${skipped ? `
                <span class="text-xs px-2 py-1 rounded-full font-medium bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400">skipped</span>
              ` : period.endDate ? `
                <span class="${UI.text.small}">${formatDate(period.startDate)} – ${formatDate(period.endDate)}</span>
              ` : `
                <span class="text-xs px-2 py-1 rounded-full font-medium text-white" style="background-color: var(--phase-accent-light);">Active</span>
              `}
              <button class="edit-period-btn ${UI.btn.icon}" data-period-id="${period.id}" data-start-date="${period.startDate}" data-end-date="${period.endDate || ''}" data-skipped="${skipped ? '1' : ''}" aria-label="Edit period">
                <span class="pointer-events-none">${ICONS.edit}</span>
              </button>
              <button class="delete-period-btn ${UI.btn.icon}" data-period-id="${period.id}" aria-label="Delete period">
                <span class="pointer-events-none">${ICONS.trash}</span>
              </button>
            </div>
          </div>
        `;
    }).join('');

    return `
        <div class="${UI.card}">
          <h3 class="${UI.text.heading} mb-4">Recent Periods</h3>
          ${historyItems}
        </div>
      `;
  }

  /**
   * Render data management section
   */
  function renderDataManagement(data) {
    const hasData = data.periods.length > 0;
    return `
        <div class="mt-4 mb-8">
          <h3 class="${UI.text.small} uppercase tracking-wide mb-3 text-center">Manage Data</h3>
          <div class="flex gap-3">
            <button id="exportDataBtn" ${!hasData ? 'disabled' : ''} class="flex-1 ${UI.btn.secondary} text-sm disabled:opacity-40 disabled:cursor-not-allowed">
              Export
            </button>
            <button id="importDataBtn" class="flex-1 ${UI.btn.secondary} text-sm">
              Import
            </button>
            <button id="clearDataBtn" ${!hasData ? 'disabled' : ''} class="flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-red-500 dark:text-red-400 bg-stone-100 dark:bg-stone-700 hover:bg-red-50 dark:hover:bg-stone-600">
              Clear
            </button>
          </div>
          <p class="text-center text-xs text-stone-400 dark:text-stone-600 mt-3">v${APP_VERSION}</p>
        </div>
      `;
  }

  /**
   * Attach event listeners after render
   */
  function attachEventListeners() {
    // Use event delegation on document to catch all clicks including modal
    document.addEventListener('click', function(e) {
      // Handle title tap for hidden debug toggle (5 taps)
      if (e.target.closest('#appTitle')) {
        debugTapCount++;

        // Reset timer
        if (debugTapTimer) clearTimeout(debugTapTimer);

        // Reset count after 2 seconds of no taps
        debugTapTimer = setTimeout(() => {
          debugTapCount = 0;
        }, 2000);

        // Toggle debug panel after 5 taps
        if (debugTapCount >= 5) {
          debugPanelVisible = !debugPanelVisible;
          debugTapCount = 0;
          render();
        }
        return;
      }

      // Handle theme toggle
      if (e.target.closest('#themeToggleBtn')) {
        toggleTheme();
        return;
      }

      // Handle toggle period button
      if (e.target.closest('#togglePeriodBtn')) {
        handleTogglePeriod();
        return;
      }

      // Handle door 1 - cycle passed with no bleeding
      if (e.target.closest('#logSkippedCycleBtn')) {
        updateData(logSkippedCycle(appData));
        return;
      }

      // Handle confirm end period (short-period prompt only)
      if (e.target.closest('#confirmEndPeriodBtn')) {
        const periodId = e.target.closest('#confirmEndPeriodBtn').dataset.periodId;
        const skippedInput = document.getElementById('endPeriodSkippedInput');
        let newData = endPeriod(appData);
        if (periodId && skippedInput && skippedInput.checked) {
          newData = updatePeriodSkipped(newData, periodId, true);
        }
        updateData(newData);
        removeModal('endPeriodModal');
        return;
      }

      // Handle cancel end period
      if (e.target.closest('#cancelEndPeriodBtn') || e.target.id === 'endPeriodModalOverlay') {
        removeModal('endPeriodModal');
        return;
      }

      // Handle delete period button
      const deleteBtn = e.target.closest('.delete-period-btn');
      if (deleteBtn) {
        e.preventDefault();
        const periodId = deleteBtn.dataset.periodId;
        if (periodId) {
          showDeleteConfirmation(periodId);
        }
        return;
      }

      // Handle confirm delete
      if (e.target.closest('#confirmDeleteBtn')) {
        const periodId = e.target.closest('#confirmDeleteBtn').dataset.periodId;
        if (periodId) {
          updateData(deletePeriod(appData, periodId));
          hideDeleteConfirmation();
        }
        return;
      }

      // Handle cancel delete
      if (e.target.closest('#cancelDeleteBtn')) {
        hideDeleteConfirmation();
        return;
      }

      // Handle clicking overlay (outside modal content)
      if (e.target.id === 'deleteModalOverlay') {
        hideDeleteConfirmation();
        return;
      }

      // Handle edit period start button (from active period display)
      if (e.target.closest('#editPeriodStartBtn')) {
        const currentPeriod = getCurrentPeriod(appData);
        if (currentPeriod) {
          showEditPeriodModal(currentPeriod.id, currentPeriod.startDate, currentPeriod.endDate, isSkip(currentPeriod));
        }
        return;
      }

      // Handle edit period button (from history)
      const editPeriodBtn = e.target.closest('.edit-period-btn');
      if (editPeriodBtn) {
        const periodId = editPeriodBtn.dataset.periodId;
        const startDate = editPeriodBtn.dataset.startDate;
        const endDate = editPeriodBtn.dataset.endDate || null;
        showEditPeriodModal(periodId, startDate, endDate, editPeriodBtn.dataset.skipped === '1');
        return;
      }

      // Handle save edit period
      if (e.target.closest('#saveEditPeriodBtn')) {
        const periodId = e.target.closest('#saveEditPeriodBtn').dataset.periodId;
        const startInput = document.getElementById('editPeriodStartInput');
        const endInput = document.getElementById('editPeriodEndInput');

        if (periodId && startInput && startInput.value) {
          let newData = updatePeriodStartDate(appData, periodId, startInput.value);

          // Update end date (can be empty string for ongoing)
          const newEndDate = endInput.value || null;
          newData = updatePeriodEndDate(newData, periodId, newEndDate);

          const skippedInput = document.getElementById('editPeriodSkippedInput');
          newData = updatePeriodSkipped(newData, periodId, !!(skippedInput && skippedInput.checked));

          updateData(newData);
          hideEditPeriodModal();
        }
        return;
      }

      // Handle cancel edit period
      if (e.target.closest('#cancelEditPeriodBtn')) {
        hideEditPeriodModal();
        return;
      }

      // Handle clicking edit period overlay
      if (e.target.id === 'editPeriodModalOverlay') {
        hideEditPeriodModal();
        return;
      }

      // Handle log past period button
      if (e.target.closest('#logPastPeriodBtn')) {
        showAddPastPeriodModal();
        return;
      }

      // Handle save past period
      if (e.target.closest('#saveAddPastPeriodBtn')) {
        const startInput = document.getElementById('pastPeriodStartInput');
        const endInput = document.getElementById('pastPeriodEndInput');
        const errorEl = document.getElementById('pastPeriodError');

        const startVal = startInput && startInput.value;
        const endVal = endInput && endInput.value;

        if (!startVal || !endVal) {
          errorEl.textContent = 'Both dates are required.';
          errorEl.classList.remove('hidden');
          return;
        }
        if (parseDate(endVal) < parseDate(startVal)) {
          errorEl.textContent = 'End date must be on or after the start date.';
          errorEl.classList.remove('hidden');
          return;
        }
        if (parseDate(startVal) > parseDate(getTodayString())) {
          errorEl.textContent = 'Start date cannot be in the future.';
          errorEl.classList.remove('hidden');
          return;
        }

        updateData(addPastPeriod(appData, startVal, endVal));
        hideAddPastPeriodModal();
        return;
      }

      // Handle cancel add past period
      if (e.target.closest('#cancelAddPastPeriodBtn')) {
        hideAddPastPeriodModal();
        return;
      }

      // Handle clicking add past period overlay
      if (e.target.id === 'addPastPeriodModalOverlay') {
        hideAddPastPeriodModal();
        return;
      }

      // Handle export button
      if (e.target.closest('#exportDataBtn')) {
        exportData(appData);
        return;
      }

      // Handle import button — trigger hidden file input
      if (e.target.closest('#importDataBtn')) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', function() {
          const file = this.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function(ev) {
            const result = parseImportFile(ev.target.result);
            if (!result.ok) {
              alert(result.error);
              return;
            }
            showImportConfirmModal(result.data);
          };
          reader.readAsText(file);
        });
        input.click();
        return;
      }

      // Handle import confirmation
      if (e.target.closest('#confirmImportBtn')) {
        const modal = document.getElementById('importConfirmModal');
        if (modal) {
          const parsed = JSON.parse(modal.dataset.importJson);
          updateData(parsed);
          removeModal('importConfirmModal');
        }
        return;
      }

      // Handle cancel import
      if (e.target.closest('#cancelImportBtn') || e.target.id === 'importConfirmModalOverlay') {
        removeModal('importConfirmModal');
        return;
      }

      // Handle clear data button
      if (e.target.closest('#clearDataBtn')) {
        showClearDataConfirmation();
        return;
      }

      // Handle confirm clear data
      if (e.target.closest('#confirmClearDataBtn')) {
        clearAllData();
        removeModal('clearDataModal');
        return;
      }

      // Handle cancel clear data
      if (e.target.closest('#cancelClearDataBtn') || e.target.id === 'clearDataModalOverlay') {
        removeModal('clearDataModal');
        return;
      }

      // Handle debug reset button
      if (e.target.closest('#debugResetBtn')) {
        debugMode = {
          enabled: false,
          cycleDay: null,
          cycleLength: 28,
          periodLength: 5
        };
        render();
        return;
      }
    });

    // Debounced render for performance during slider dragging
    const debouncedRender = debounce(render, 16); // ~60fps

    // Handle debug slider and checkbox inputs
    document.addEventListener('input', function(e) {
      if (e.target.id === 'debugDaySlider') {
        debugMode.cycleDay = parseInt(e.target.value, 10);
        debouncedRender();
      }
      if (e.target.id === 'debugCycleLengthSlider') {
        debugMode.cycleLength = parseInt(e.target.value, 10);
        debouncedRender();
      }
      if (e.target.id === 'debugPeriodLengthSlider') {
        debugMode.periodLength = parseInt(e.target.value, 10);
        debouncedRender();
      }
    });

    // Handle debug toggle checkbox
    document.addEventListener('change', function(e) {
      if (e.target.id === 'debugToggle') {
        debugMode.enabled = e.target.checked;
        if (debugMode.enabled && debugMode.cycleDay === null) {
          // Initialize with current values when enabling
          debugMode.cycleDay = getCurrentCycleDay(appData) || 1;
          debugMode.cycleLength = getAverageCycleLength(appData);
          debugMode.periodLength = getAveragePeriodLength(appData);
        }
        render();
      }
    });
  }

  /**
   * Show delete confirmation modal
   */
  function showDeleteConfirmation(periodId) {
    const content = `
        <h3 class="${UI.text.heading} mb-2">Remove Period?</h3>
        <p class="${UI.text.body} mb-6">This will remove this period from your history.</p>
        <div class="flex gap-3">
          <button id="cancelDeleteBtn" class="flex-1 ${UI.btn.secondary}">Cancel</button>
          <button id="confirmDeleteBtn" data-period-id="${periodId}" class="flex-1 ${UI.btn.danger}">Remove</button>
        </div>
      `;
    document.body.appendChild(createModal('deleteModal', content));
  }

  /**
   * Hide delete confirmation modal
   */
  function hideDeleteConfirmation() {
    removeModal('deleteModal');
  }

  /**
   * Show edit period modal (for both start and end dates)
   */
  function showEditPeriodModal(periodId, startDate, endDate, skipped) {
    const today = getTodayString();
    const isOngoing = !endDate;

    const content = `
        <h3 class="${UI.text.heading} mb-2">Edit Period</h3>
        <p class="${UI.text.body} mb-4">Adjust the dates for this period.</p>

        <div class="space-y-4 mb-6">
          <div>
            <label class="block ${UI.text.small} mb-2">Start date</label>
            <input type="date" id="editPeriodStartInput" value="${startDate}" max="${endDate || today}" class="${UI.input}">
          </div>

          <div>
            <label class="block ${UI.text.small} mb-2">End date ${isOngoing ? '<span class="opacity-70">(ongoing)</span>' : ''}</label>
            <input type="date" id="editPeriodEndInput" value="${endDate || ''}" min="${startDate}" max="${today}" ${isOngoing ? 'placeholder="Still ongoing"' : ''} class="${UI.input}">
            ${isOngoing ? `<p class="${UI.text.small} mt-1">Leave empty if still ongoing</p>` : ''}
          </div>

          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" id="editPeriodSkippedInput" ${skipped ? 'checked' : ''} class="mt-1 w-4 h-4 accent-rose-500">
            <span class="${UI.text.body}">I didn't bleed<br><span class="${UI.text.small}">Keeps the dates, but leaves this cycle out of your averages.</span></span>
          </label>
        </div>

        <div class="flex gap-3">
          <button id="cancelEditPeriodBtn" class="flex-1 ${UI.btn.secondary}">Cancel</button>
          <button id="saveEditPeriodBtn" data-period-id="${periodId}" class="flex-1 ${UI.btn.primary}" style="background-color: var(--phase-gradient-from);">Save</button>
        </div>
      `;
    document.body.appendChild(createModal('editPeriodModal', content));
  }

  /**
   * Hide edit period modal
   */
  function hideEditPeriodModal() {
    removeModal('editPeriodModal');
  }

  /**
   * Show add past period modal
   */
  function showAddPastPeriodModal() {
    const today = getTodayString();
    const content = `
        <h3 class="${UI.text.heading} mb-2">Log Past Period</h3>
        <p class="${UI.text.body} mb-4">Enter the dates for a previous period.</p>

        <div class="space-y-4 mb-2">
          <div>
            <label class="block ${UI.text.small} mb-2">Start date</label>
            <input type="date" id="pastPeriodStartInput" max="${today}" class="${UI.input}">
          </div>
          <div>
            <label class="block ${UI.text.small} mb-2">End date</label>
            <input type="date" id="pastPeriodEndInput" max="${today}" class="${UI.input}">
          </div>
        </div>

        <p id="pastPeriodError" class="text-red-500 text-sm mb-4 hidden"></p>

        <div class="flex gap-3">
          <button id="cancelAddPastPeriodBtn" class="flex-1 ${UI.btn.secondary}">Cancel</button>
          <button id="saveAddPastPeriodBtn" class="flex-1 ${UI.btn.primary}" style="background-color: var(--phase-gradient-from);">Save</button>
        </div>
      `;
    document.body.appendChild(createModal('addPastPeriodModal', content));

    // Wire start date change to update end date min
    document.getElementById('pastPeriodStartInput').addEventListener('change', function() {
      document.getElementById('pastPeriodEndInput').min = this.value;
    });
  }

  /**
   * Hide add past period modal
   */
  function hideAddPastPeriodModal() {
    removeModal('addPastPeriodModal');
  }

  /**
   * Show import confirmation modal after a file has been parsed
   */
  function showImportConfirmModal(parsedData) {
    const periodCount = parsedData.periods.length;
    const hasExisting = appData.periods.length > 0;
    const content = `
        <h3 class="${UI.text.heading} mb-2">Import Data</h3>
        <p class="${UI.text.body} mb-1">Found <strong>${periodCount} period${periodCount !== 1 ? 's' : ''}</strong> in this backup.</p>
        ${hasExisting ? `<p class="text-sm text-red-500 dark:text-red-400 mb-6">This will replace all your current data.</p>` : `<p class="${UI.text.body} mb-6"></p>`}
        <div class="flex gap-3">
          <button id="cancelImportBtn" class="flex-1 ${UI.btn.secondary}">Cancel</button>
          <button id="confirmImportBtn" class="flex-1 ${UI.btn.primary}" style="background-color: var(--phase-gradient-from);">Import</button>
        </div>
      `;
    const modal = createModal('importConfirmModal', content);
    modal.dataset.importJson = JSON.stringify(parsedData);
    document.body.appendChild(modal);
  }

  /**
   * Show clear data confirmation modal
   */
  function showClearDataConfirmation() {
    const count = appData.periods.length;
    const content = `
        <h3 class="${UI.text.heading} mb-2">Clear All Data?</h3>
        <p class="${UI.text.body} mb-6">This will permanently delete ${count} period${count !== 1 ? 's' : ''} and cannot be undone.</p>
        <div class="flex gap-3">
          <button id="cancelClearDataBtn" class="flex-1 ${UI.btn.secondary}">Cancel</button>
          <button id="confirmClearDataBtn" class="flex-1 ${UI.btn.danger}">Clear</button>
        </div>
      `;
    document.body.appendChild(createModal('clearDataModal', content));
  }

  /**
   * Show the end-period prompt. Only reached for suspiciously short periods -
   * a normal-length period ends on a single tap with no modal at all.
   */
  function showEndPeriodModal(period, length, avgPeriod) {
    const content = `
        <h3 class="${UI.text.heading} mb-2">End Period?</h3>
        <p class="${UI.text.body} mb-4">That's ${length} day${length !== 1 ? 's' : ''}, shorter than your usual ${avgPeriod} days.</p>

        <label class="flex items-start gap-3 mb-6 cursor-pointer">
          <input type="checkbox" id="endPeriodSkippedInput" class="mt-1 w-4 h-4 accent-rose-500">
          <span class="${UI.text.body}">I didn't bleed<br><span class="${UI.text.small}">Keeps the dates, but leaves this cycle out of your averages.</span></span>
        </label>

        <div class="flex gap-3">
          <button id="cancelEndPeriodBtn" class="flex-1 ${UI.btn.secondary}">Cancel</button>
          <button id="confirmEndPeriodBtn" data-period-id="${period.id}" class="flex-1 ${UI.btn.primary}" style="background-color: var(--phase-gradient-from);">End Period</button>
        </div>
      `;
    document.body.appendChild(createModal('endPeriodModal', content));
  }

  /**
   * Handle toggle period button click
   */
  function handleTogglePeriod() {
    if (!isOnPeriod(appData)) {
      updateData(startPeriod(appData));
      return;
    }

    // Ending is one tap unless this looks like a false start - far shorter
    // than this user's own average - in which case ask whether they bled.
    const current = getCurrentPeriod(appData);
    const avgPeriod = getAveragePeriodLength(appData);
    const length = current ? daysBetween(current.startDate, getTodayString()) + 1 : 0;

    if (current && length < Math.max(2, avgPeriod / 2)) {
      showEndPeriodModal(current, length, avgPeriod);
      return;
    }

    updateData(endPeriod(appData));
  }

  // ==========================================
  // INITIALIZE APP
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    attachEventListeners();
    render();
  });

  // ==========================================
  // SERVICE WORKER
  // ==========================================
  if ('serviceWorker' in navigator) {
    // Unregister any legacy service workers (e.g. old blob URL registrations)
    // before registering the new one. localStorage is never affected.
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(
        registrations
          .filter((reg) => {
            const url = (reg.active || reg.installing || reg.waiting)?.scriptURL || '';
            return !url.endsWith('/sw.js');
          })
          .map((reg) => reg.unregister())
      ))
      .then(() => navigator.serviceWorker.register('/sw.js'))
      .then(() => console.log('Cycle: Offline ready'))
      .catch((err) => console.warn('Cycle: SW registration failed', err));
  }
