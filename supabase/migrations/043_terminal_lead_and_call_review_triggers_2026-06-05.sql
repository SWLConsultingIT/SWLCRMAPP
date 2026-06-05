-- Make two invariants impossible to violate again, at the DB layer — so no
-- code path (call-outcome popup, n8n reply handlers, manual status change,
-- bulk edits, future features) can re-break them.
--
-- Context (2026-06-05): a positive/negative call outcome left the flow running
-- (the app only stopped status='active' campaigns, missing PAUSED ones) and
-- the seller's own call outcome reappeared in the Inbox "Pending review" tab
-- (lead_replies.review_status defaults to 'pending'). Both were patched in the
-- route, but Fran: "eso no puede pasar más". These triggers are the guarantee.

-- ── INVARIANT 1: a lead in a hard-terminal status has NO active/paused campaigns.
-- Terminal set matches the dispatchers' `hardTerminal`
-- (dispatch-queue / dispatch-email): qualified | closed_won | closed_lost.
-- They already refuse to send to these leads; this just keeps the campaign
-- row's state honest (and the metrics with it).
CREATE OR REPLACE FUNCTION public.stop_campaigns_on_terminal_lead()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('qualified', 'closed_won', 'closed_lost')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.campaigns
    SET status       = CASE WHEN NEW.status = 'closed_lost' THEN 'closed_lost' ELSE 'completed' END,
        stop_reason  = COALESCE(stop_reason, 'lead_' || NEW.status),
        completed_at = COALESCE(completed_at, now())
    WHERE lead_id = NEW.id
      AND status IN ('active', 'paused');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stop_campaigns_on_terminal_lead ON public.leads;
CREATE TRIGGER trg_stop_campaigns_on_terminal_lead
  AFTER UPDATE OF status ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.stop_campaigns_on_terminal_lead();

-- ── INVARIANT 2: a call reply that doesn't explicitly need review is never
-- "Pending review". Call outcomes are seller-entered or system-classified
-- (every call insert sets requires_human_review=false); only a row that
-- explicitly asks for review (requires_human_review=true) may stay pending.
CREATE OR REPLACE FUNCTION public.resolve_call_outcome_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.channel = 'call' AND COALESCE(NEW.requires_human_review, false) = false THEN
    NEW.review_status := 'approved';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_call_outcome_review ON public.lead_replies;
CREATE TRIGGER trg_resolve_call_outcome_review
  BEFORE INSERT ON public.lead_replies
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_call_outcome_review();
