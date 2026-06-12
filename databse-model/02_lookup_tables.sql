BEGIN;

-- ============================================================
-- LOOKUP / DICTIONARY TABLES
-- All use SMALLINT (or INTEGER for large-cardinality sets) PKs
-- via GENERATED ALWAYS AS IDENTITY.
-- description TEXT is present on every lookup table for API dropdown labels.
-- Seed inserts use ON CONFLICT (name) DO NOTHING for idempotency.
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_domains (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS tenant_plan_types (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS org_types (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    description TEXT,
    rank        SMALLINT NOT NULL DEFAULT 0   -- privilege level: higher = more access; 0–100 range
                    CONSTRAINT chk_user_roles_rank CHECK (rank >= 0 AND rank <= 100),
    label       TEXT     NOT NULL DEFAULT ''   -- human-readable display name (mirrors ROLE_LABELS)
);

CREATE TABLE IF NOT EXISTS marketing_platforms (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS campaign_statuses (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS lead_statuses (
    id                SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name              TEXT     UNIQUE NOT NULL,
    description       TEXT,
    label             TEXT     NOT NULL DEFAULT '',    -- human-readable display name for dropdowns
    requires_followup BOOLEAN  NOT NULL DEFAULT FALSE, -- follow-up must be scheduled on transition
    is_rejection      BOOLEAN  NOT NULL DEFAULT FALSE  -- opens rejection form (fail-reason + note) on transition
);

CREATE TABLE IF NOT EXISTS lead_fail_reasons (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    description TEXT,
    label       TEXT     NOT NULL DEFAULT ''   -- human-readable display name for dropdowns
);

CREATE TABLE IF NOT EXISTS interaction_types (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS follow_up_statuses (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    description TEXT
);

-- ============================================================
-- GEOGRAPHIC LOOKUP TABLES (NEW)
-- Used for structured address fields on organizations and leads.
-- countries: SMALLINT sufficient (≤250 nations)
-- states:    SMALLINT sufficient (≤500 for initial scope)
-- cities:    INTEGER for global scale (millions possible)
-- ============================================================

CREATE TABLE IF NOT EXISTS countries (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name        TEXT     UNIQUE NOT NULL,
    iso_code    CHAR(2)  UNIQUE NOT NULL,  -- ISO 3166-1 alpha-2
    description TEXT
);

CREATE TABLE IF NOT EXISTS states (
    id          SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    country_id  SMALLINT NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    name        TEXT     NOT NULL,
    code        TEXT,                      -- e.g. 'DL', 'MH', 'KA'
    description TEXT,
    CONSTRAINT uq_states_country_name UNIQUE (country_id, name)
);

CREATE TABLE IF NOT EXISTS cities (
    id          INTEGER  PRIMARY KEY GENERATED ALWAYS AS IDENTITY, -- INTEGER: high cardinality
    state_id    SMALLINT NOT NULL REFERENCES states(id)  ON DELETE RESTRICT,
    name        TEXT     NOT NULL,
    description TEXT,
    CONSTRAINT uq_cities_state_name UNIQUE (state_id, name)
);

-- ============================================================
-- SEED DATA - LOOKUP VALUES
-- Deterministic insertion order defines GENERATED IDENTITY values:
--   tenant_domains:    fitness=1 retail=2 medical=3 hospitality=4
--                      real_estate=5 education=6 automotive=7 logistics=8
--   tenant_plan_types: free_trial=1 starter=2 growth=3 enterprise=4
--   org_types:         branch=1 franchise=2 clinic=3 gym_location=4
--                      warehouse=5 showroom=6 head_office=7
--   user_roles:        super_admin=1 tenant_admin=2 org_admin=3 org_sr_manager=4
--                      org_manager=5 senior_sales_executive=6 sales_rep=7 read_only=8
--   marketing_platforms: facebook=1 google=2 linkedin=3 instagram=4
--                        tiktok=5 organic=6 referral=7 whatsapp_ads=8
--   campaign_statuses: draft=1 active=2 paused=3 completed=4 archived=5
--   lead_statuses:     new=1 contacted=2 qualified=3 converted=4
--                      failed=5 on_hold=6 nurturing=7
--   lead_fail_reasons: wrong_number=1 not_interested=2 budget_constraint=3
--                      no_response=4 duplicate=5 spam=6 invalid_lead=7
--   interaction_types: call=1 whatsapp=2 email=3 sms=4
--                      in_person=5 video_call=6 chat=7
--   follow_up_statuses: pending=1 completed=2 missed=3 rescheduled=4
-- NOTE: 09_seed_data.sql uses subquery lookups by name - NOT hardcoded IDs.
-- ============================================================

INSERT INTO tenant_domains (name, description) VALUES
    ('fitness',      'Gyms, fitness centres, yoga studios, personal training'),
    ('retail',       'Fashion boutiques, apparel, accessories, lifestyle stores'),
    ('medical',      'Clinics, hospitals, diagnostic centres, healthcare providers'),
    ('hospitality',  'Hotels, resorts, restaurants, event venues'),
    ('real_estate',  'Property sales, rentals, property management'),
    ('education',    'Schools, coaching centres, e-learning platforms'),
    ('automotive',   'Car dealerships, service centres, vehicle rentals'),
    ('logistics',    'Warehousing, freight, courier, supply chain')
ON CONFLICT (name) DO NOTHING;

INSERT INTO tenant_plan_types (name, description) VALUES
    ('free_trial', 'Up to 3 users, 1 org, 100 leads - 30-day trial'),
    ('starter',    'Up to 10 users, 2 orgs, 1 000 leads/month'),
    ('growth',     'Up to 50 users, 10 orgs, 10 000 leads/month, AI scoring'),
    ('enterprise', 'Unlimited users and orgs, dedicated support, custom SLA')
ON CONFLICT (name) DO NOTHING;

INSERT INTO org_types (name, description) VALUES
    ('branch',      'Standard branch office of a business'),
    ('franchise',   'Franchise outlet operating under a licensor brand'),
    ('clinic',      'Medical or wellness clinic unit'),
    ('gym_location','Physical gym or fitness centre location'),
    ('warehouse',   'Storage or fulfilment centre'),
    ('showroom',    'Product display and sales showroom'),
    ('head_office', 'Corporate headquarters or registered office')
ON CONFLICT (name) DO NOTHING;

INSERT INTO user_roles (name, description, rank, label) VALUES
    ('super_admin',            'Platform-level superuser - SaaS admin only',                                      100, 'Super Admin'),
    ('tenant_admin',           'Tenant-level admin - manages all orgs under the tenant',                           90, 'Tenant Admin'),
    ('org_admin',              'Org-level admin - full control within one org',                                    80, 'Org Admin'),
    ('org_sr_manager',         'Manages a team of managers and reps within an org',                               70, 'Senior Manager'),
    ('org_manager',            'Manages a team of Senior Sales Executives and reps within an org',                60, 'Manager'),
    ('senior_sales_executive', 'Senior Sales Executive - manages a team of sales reps; reports to org_manager',   40, 'Senior Sales Executive'),
    ('sales_rep',              'Front-line sales - manages own assigned leads and follow-ups',                     20, 'Sales Representative'),
    ('read_only',              'Read-only viewer - dashboards and reports only',                                    0, 'Read Only')
ON CONFLICT (name) DO UPDATE SET rank = EXCLUDED.rank, label = EXCLUDED.label, description = EXCLUDED.description;

INSERT INTO marketing_platforms (name, description) VALUES
    ('facebook',     'Facebook / Instagram Lead Ads and Campaigns'),
    ('google',       'Google Ads (Search, Display, Shopping, Performance Max)'),
    ('linkedin',     'LinkedIn Lead Gen Forms and sponsored content'),
    ('instagram',    'Instagram organic and paid posts'),
    ('tiktok',       'TikTok for Business lead generation'),
    ('organic',      'Walk-in, direct website, or offline enquiry with no paid source'),
    ('referral',     'Referred by an existing customer or partner'),
    ('whatsapp_ads', 'WhatsApp click-to-chat ads via Facebook Ads Manager')
ON CONFLICT (name) DO NOTHING;

INSERT INTO campaign_statuses (name, description) VALUES
    ('draft',     'Campaign created but not yet submitted for review or activation'),
    ('active',    'Campaign is live and currently running'),
    ('paused',    'Campaign temporarily paused; can be resumed'),
    ('completed', 'Campaign ran its full duration and ended normally'),
    ('archived',  'Campaign permanently closed and moved to archive')
ON CONFLICT (name) DO NOTHING;

INSERT INTO lead_statuses (name, description, label, requires_followup, is_rejection) VALUES
    ('new',       'Lead just received - not yet contacted',                        'New',       FALSE, FALSE),
    ('contacted', 'First contact made - call, WhatsApp, or email sent',            'Contacted', TRUE,  FALSE),
    ('qualified', 'Lead confirmed as a genuine prospect with intent and budget',   'Qualified', FALSE, FALSE),
    ('converted', 'Lead became a paying customer',                                 'Converted', FALSE, FALSE),
    ('failed',    'Lead did not convert - fail reason and note must be recorded',  'Failed',    FALSE, TRUE),
    ('on_hold',   'Lead paused by request or external circumstance',               'On Hold',   TRUE,  FALSE),
    ('nurturing', 'Long-cycle lead kept warm via periodic touches',                'Nurturing', FALSE, FALSE)
ON CONFLICT (name) DO UPDATE SET
    label             = EXCLUDED.label,
    requires_followup = EXCLUDED.requires_followup,
    is_rejection      = EXCLUDED.is_rejection;

INSERT INTO lead_fail_reasons (name, description, label) VALUES
    ('wrong_number',       'Phone number provided is incorrect or non-existent',            'Wrong Number'),
    ('not_interested',     'Lead explicitly declined and asked not to be contacted',         'Not Interested'),
    ('budget_constraint',  'Lead''s budget does not meet the product or service pricing',   'Budget Constraint'),
    ('no_response',        'No reply after multiple contact attempts over defined period',   'No Response'),
    ('duplicate',          'Lead is a duplicate of an existing record in the system',        'Duplicate'),
    ('spam',               'Submission identified as bot, spam, or malicious form fill',     'Spam'),
    ('invalid_lead',       'Lead details are fabricated, untraceable, or otherwise invalid', 'Invalid Lead')
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;

INSERT INTO interaction_types (name, description) VALUES
    ('call',       'Outbound or inbound phone call'),
    ('whatsapp',   'WhatsApp message (text, audio, or media)'),
    ('email',      'Email sent or received'),
    ('sms',        'SMS or text message'),
    ('in_person',  'Face-to-face meeting at store, office, or event'),
    ('video_call', 'Video call via Zoom, Google Meet, WhatsApp Video, etc.'),
    ('chat',       'Live chat on website or social media platform')
ON CONFLICT (name) DO NOTHING;

INSERT INTO follow_up_statuses (name, description) VALUES
    ('pending',     'Follow-up scheduled and not yet actioned'),
    ('completed',   'Follow-up actioned within the scheduled window'),
    ('missed',      'Follow-up was not actioned before the scheduled time'),
    ('rescheduled', 'Follow-up postponed to a new scheduled_at datetime')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- SEED DATA - GEOGRAPHIC LOOKUPS
-- India-focused initial data. Extend as the CRM expands globally.
-- ============================================================

INSERT INTO countries (name, iso_code) VALUES
    ('India',          'IN'),
    ('United States',  'US'),
    ('United Kingdom', 'GB'),
    ('United Arab Emirates', 'AE')
ON CONFLICT (name) DO NOTHING;

-- Indian states (insert after countries so country_id is available via subquery)
INSERT INTO states (country_id, name, code)
SELECT c.id, s.name, s.code
FROM countries c
CROSS JOIN (VALUES
    ('Delhi',             'DL'),
    ('Maharashtra',       'MH'),
    ('Karnataka',         'KA'),
    ('Tamil Nadu',        'TN'),
    ('West Bengal',       'WB'),
    ('Telangana',         'TS'),
    ('Rajasthan',         'RJ'),
    ('Gujarat',           'GJ'),
    ('Uttar Pradesh',     'UP'),
    ('Haryana',           'HR'),
    ('Punjab',            'PB'),
    ('Madhya Pradesh',    'MP')
) AS s(name, code)
WHERE c.iso_code = 'IN'
ON CONFLICT (country_id, name) DO NOTHING;

-- Cities per state
INSERT INTO cities (state_id, name)
SELECT s.id, c.name
FROM states s
CROSS JOIN (VALUES
    ('Delhi',          'New Delhi'),
    ('Delhi',          'Dwarka'),
    ('Delhi',          'Rohini'),
    ('Delhi',          'Lajpat Nagar'),
    ('Delhi',          'Connaught Place'),
    ('Delhi',          'Saket'),
    ('Delhi',          'Janakpuri'),
    ('Uttar Pradesh',  'Lucknow'),
    ('Uttar Pradesh',  'Noida'),
    ('Uttar Pradesh',  'Agra'),
    ('Haryana',        'Gurgaon'),
    ('Haryana',        'Faridabad'),
    ('Punjab',         'Chandigarh'),
    ('Punjab',         'Amritsar')
) AS c(state_name, name)
WHERE s.name = c.state_name
ON CONFLICT (state_id, name) DO NOTHING;

COMMIT;
