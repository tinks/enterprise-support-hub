

## Update knowledge file with recent changes

### What's being added

Submit a pending knowledge update covering these 5 recent changes:

**1. Employee admin ID attribution (§7, new subsection after "Human Admin Identity")**
Add documentation about the hardcoded `EMPLOYEE_ADMIN_IDS` map (`joel@lovable.dev → 8430778`, `kristina@lovable.dev → 9985999`) used in `slack-events` to post employee replies as their real Intercom admin, preventing Sam from auto-assigning/closing.

**2. Enterprise inbox routing (§4, Step 4 update + §6 Step 4 update)**
Update Step 4 to note that after assigning to Sam, a second assignment call moves the conversation into the enterprise team inbox so all conversations are visible to the team from creation — not just after escalation. Same for auto-proceed in context-reminder.

**3. Dynamic "continue chatting" hint (§6, Step 6b-ii update)**
Note that the hint text is now conditional: "To continue chatting, please send a reply in the thread" for human admin replies (drops "with Sam").

**4. Triple admin name fix (§7, Human Admin Identity update)**
Note that the body prefix (`*AdminName:*`) was removed for human admin replies since the bot username and reply header already attribute the sender.

**5. Conversation detail page (§2, UI Pages table)**
Add `/conversations/:id` → ConversationDetail → "View full conversation details, change status, toggle test flag, quick links to Slack/Intercom"

### How
- Read current `content` from `knowledge_documents`
- Apply all 5 changes
- Write to `pending_content` + `pending_summary` via database update
- User reviews and approves in Knowledge tab

### Summary
- No code file changes
- 1 database update (pending knowledge content)
- User approval required via Knowledge tab

