select *
from public.schema_versions;

--create database crm;

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
from public.user_roles


select *
from public.users
where email = 'nisha.goyal@fitclass.in';

select *
from public.marketing_platforms

select *
from public.marketing_leads


select *
from public.users
where email = 'pradeep.chopra@fitclass.in';

select *
from organizations
where id = 'b1000001-0000-0000-0000-000000000001'

select *
from public.users
where users.org_id = 'b1000001-0000-0000-0000-000000000001'