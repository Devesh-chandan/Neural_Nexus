"""All fixed rules of Module 2 in one place.

Change a number here and every part of the engine follows it.
"""

ENGINE_VERSION = "sim-1.0"

# ---- How many scenarios and how they are picked -------------------------
N_SCENARIOS = 20            # total simulations per product
N_FIXED = 5                 # worst, best, 10% drop, sideways, most recent
N_SPREAD = 15               # evenly spaced picks along the line-up
SPACING_TRADING_DAYS = 60   # two picks must start at least this far apart

DROP_TARGET = -0.10         # the "10% drop" slot looks for this move
MATCH_TOLERANCE = 0.02      # +/- 2 points counts as a real match

# "Sideways": among periods that ended within this band, pick the calmest one
SIDEWAYS_BAND = {"equity": 0.01, "fx": 0.0025}

# Labels for the 15 spread picks: (flat band, big-move band)
#   move <= -big          -> Big fall
#   -big < move < -flat   -> Fall
#   -flat <= move <= flat -> Flat
#   flat < move <= big    -> Rise
#   move > big            -> Big rise
LABEL_BANDS = {"equity": (0.05, 0.20), "fx": (0.01, 0.03)}

# ---- Dates and tenor ------------------------------------------------------
DAYS_PER_MONTH = 30.4375    # used only for the fractional part of a tenor
MAX_TENOR_MONTHS = 120

# ---- Market data ------------------------------------------------------------
CACHE_MAX_AGE_HOURS = 12    # re-download after this
STALE_AFTER_DAYS = 5        # last price older than this -> STALE_DATA warning
MIN_PRICE_POINTS = 60       # fewer clean prices than this -> refuse to run
# A one-day jump bigger than this that fully reverses the next day is a bad tick
SPIKE_THRESHOLD = {"equity": 0.25, "fx": 0.08}

# Circuit breaker for the live provider
BREAKER_FAILURES = 3
BREAKER_COOLDOWN_SECONDS = 300
HTTP_TIMEOUT_SECONDS = 20

EPS = 1e-12                 # float tolerance for barrier / strike comparisons
