select *
from public.schema_versions;

create database crm;

--drop database crm(force)

select status_id,*
from public.marketing_leads
where email = 'vikash.gupta@hotmail.com'

select *
from public.lead_follow_ups

select *
--update public.lead_statuses set requires_followup = False
from public.lead_statuses
where name = 'nurturing'

select *
from public.user_roles;

select *
from public.users;