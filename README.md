# Enterprise Support Hub

I want to create a project which works as a connector between Slack and intercom. When an enterprise user tags a specific user, use me (Joel Samuelson) to start in one of added channels (will use a test channel e.g. "enterprise-support-test"), then it will create a ticket in intercom, assign it to a specific inbox and our ai support bot Sam, and it's replies will be sent back to this lovable project through intercom AI, and this project's Lovable connection will send a reply in Slack, and so on. would that work and ask for details that are needed to set this up, i have slack connector and intercom webhook ready to start. 

then I also want to add so that users can react with a button shown as thumbs up or thumbs down and if thumbs down, it will be routed to a human (or unassigned so a human can assign it) and so on. Does this make sense and do you think it will be possible? 

the ui does not have to be advanced right now, just like normal elements where I can configure settings like what channels are monitored, what inbox id and what user id to assign to etc.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://enterprise-support-hub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0bb0198a-d579-40ab-9101-dfd268f239a5).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
