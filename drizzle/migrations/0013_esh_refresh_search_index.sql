create or replace function public.esh_refresh_search_index(p_kinds text[] default null)
returns table(kind text, rows_indexed integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
begin
  -- v3 tickets (subject, contact, attributes, tags, CSAT remark, full message bodies)
  if p_kinds is null or 'v3_ticket' = any(p_kinds) then
    delete from public.esh_search_index where esh_search_index.kind = 'v3_ticket';
    insert into public.esh_search_index (kind, ref_id, title, body, idents, meta, url_path, source_updated_at)
    select
      'v3_ticket',
      t.intercom_conversation_id,
      coalesce(nullif(btrim(t.subject_override), ''), nullif(btrim(t.subject), ''), '(no subject)'),
      btrim(concat_ws(E'\n',
        public.esh_strip_html(t.raw_payload->'source'->>'body'),
        (select string_agg(public.esh_strip_html(p->>'body'), E'\n')
           from jsonb_array_elements(coalesce(t.raw_payload->'conversation_parts'->'conversation_parts', '[]'::jsonb)) p
          where nullif(btrim(coalesce(p->>'body','')), '') is not null),
        (select string_agg(a.key || ': ' || a.value, E'\n')
           from jsonb_each_text(coalesce(t.custom_attributes, '{}'::jsonb)) a
          where nullif(btrim(coalesce(a.value,'')), '') is not null),
        nullif(array_to_string(t.tags, ' '), ''),
        t.csat_remark,
        t.contact_name,
        t.customer_override_reason
      )),
      concat_ws(' ',
        t.intercom_conversation_id, t.contact_email, t.contact_domain, t.customer_key,
        t.slack_channel_id_detected, t.workspace_id_detected, t.project_uuid_detected,
        t.owner, t.product_area, t.classification, t.state, t.lifecycle_status, t.plan_tier,
        (select string_agg(a.value, ' ')
           from jsonb_each_text(coalesce(t.custom_attributes, '{}'::jsonb)) a
          where a.key in ('Linear Issue','Escalated Issue'))
      ),
      jsonb_build_object(
        'state', t.state, 'lifecycle_status', t.lifecycle_status, 'owner', t.owner,
        'customer_key', t.customer_key, 'contact_email', t.contact_email,
        'classification', t.classification, 'plan_tier', t.plan_tier,
        'created_at', t.intercom_created_at, 'intercom_id', t.intercom_conversation_id
      ),
      '/inbox-v3?q=' || t.intercom_conversation_id,
      greatest(coalesce(t.intercom_updated_at, t.updated_at), t.updated_at)
    from public.intercom_tickets_v3 t;
  end if;

  -- conversation notes
  if p_kinds is null or 'note' = any(p_kinds) then
    delete from public.esh_search_index where esh_search_index.kind = 'note';
    insert into public.esh_search_index (kind, ref_id, title, body, idents, meta, url_path, source_updated_at)
    select
      'note',
      n.id::text,
      'Note by ' || n.author || coalesce(' — ' || nullif(btrim(coalesce(v.subject_override, v.subject, '')), ''), ''),
      n.note_text,
      concat_ws(' ', n.conversation_id::text, v.intercom_conversation_id, n.conversation_source, n.author),
      jsonb_build_object('author', n.author, 'source', n.conversation_source,
                         'intercom_id', v.intercom_conversation_id, 'created_at', n.created_at),
      case
        when v.intercom_conversation_id is not null then '/inbox-v3?q=' || v.intercom_conversation_id
        else '/conversations/' || n.conversation_id::text
      end,
      n.created_at
    from public.conversation_notes n
    left join public.intercom_tickets_v3 v on v.id = n.conversation_id;
  end if;

  -- dev escalations
  if p_kinds is null or 'escalation' = any(p_kinds) then
    delete from public.esh_search_index where esh_search_index.kind = 'escalation';
    insert into public.esh_search_index (kind, ref_id, title, body, idents, meta, url_path, source_updated_at)
    select
      'escalation',
      e.id::text,
      coalesce(nullif(btrim(e.linear_key || ' — ' || coalesce(e.linear_title, '')), '—'),
               nullif(btrim(coalesce(v.subject_override, v.subject, '')), ''),
               'Escalation ' || e.intercom_conversation_id),
      concat_ws(E'\n', e.note, e.linear_title, e.linear_state, e.linear_assignee,
                nullif(btrim(coalesce(v.subject_override, v.subject, '')), '')),
      concat_ws(' ', e.intercom_conversation_id, e.linear_key, e.linear_url_override, e.owner, e.hub_state),
      jsonb_build_object('hub_state', e.hub_state, 'linear_key', e.linear_key,
                         'linear_state', e.linear_state, 'owner', e.owner,
                         'intercom_id', e.intercom_conversation_id),
      '/escalations?q=' || coalesce(e.linear_key, e.intercom_conversation_id),
      e.updated_at
    from public.dev_escalations e
    left join public.intercom_tickets_v3 v on v.intercom_conversation_id = e.intercom_conversation_id;
  end if;

  -- backlog items
  if p_kinds is null or 'backlog' = any(p_kinds) then
    delete from public.esh_search_index where esh_search_index.kind = 'backlog';
    insert into public.esh_search_index (kind, ref_id, title, body, idents, meta, url_path, source_updated_at)
    select
      'backlog', b.id::text, b.title,
      concat_ws(E'\n', b.description, b.linked_ref, b.area, b.assignee),
      concat_ws(' ', b.linked_ref, b.category, b.status, b.priority, b.area, b.assignee, b.source),
      jsonb_build_object('status', b.status, 'category', b.category, 'priority', b.priority, 'area', b.area),
      '/backlog?q=' || b.id::text,
      b.updated_at
    from public.esh_backlog_items b;
  end if;

  -- customer registry
  if p_kinds is null or 'customer' = any(p_kinds) then
    delete from public.esh_search_index where esh_search_index.kind = 'customer';
    insert into public.esh_search_index (kind, ref_id, title, body, idents, meta, url_path, source_updated_at)
    select
      'customer', c.account_key, c.label,
      concat_ws(E'\n', c.notes, array_to_string(c.domains, ' '), array_to_string(coalesce(c.aliases, '{}'), ' ')),
      concat_ws(' ', c.account_key, array_to_string(c.domains, ' '), array_to_string(coalesce(c.aliases, '{}'), ' '), c.tier, c.csm_owner, c.status),
      jsonb_build_object('tier', c.tier, 'status', c.status, 'csm_owner', c.csm_owner, 'domains', to_jsonb(c.domains)),
      '/customers',
      c.updated_at
    from public.v3_customer_accounts c;
  end if;

  -- severity proposals (model rationale + human override reasons)
  if p_kinds is null or 'severity_proposal' = any(p_kinds) then
    delete from public.esh_search_index where esh_search_index.kind = 'severity_proposal';
    insert into public.esh_search_index (kind, ref_id, title, body, idents, meta, url_path, source_updated_at)
    select
      'severity_proposal', s.id::text,
      'Severity ' || s.proposed_severity || ' proposal — ' ||
        coalesce(nullif(btrim(coalesce(v.subject_override, v.subject, '')), ''), s.intercom_conversation_id),
      concat_ws(E'\n', s.rationale, s.evidence, s.override_reason_note, s.input_excerpt),
      concat_ws(' ', s.intercom_conversation_id, s.status, s.confidence, s.override_reason_code, s.model),
      jsonb_build_object('status', s.status, 'proposed_severity', s.proposed_severity,
                         'final_severity', s.final_severity, 'intercom_id', s.intercom_conversation_id),
      '/severity-ai',
      s.updated_at
    from public.severity_proposals s
    left join public.intercom_tickets_v3 v on v.intercom_conversation_id = s.intercom_conversation_id;
  end if;

  return query
    select i.kind, count(*)::integer
    from public.esh_search_index i
    group by i.kind
    order by i.kind;
end;
$$;

grant execute on function public.esh_refresh_search_index(text[]) to authenticated, service_role;