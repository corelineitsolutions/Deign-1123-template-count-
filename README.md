# Template Count Board

Daily image and video counts for the design team, extra images per week, and a weekly winner.

## Files

- `index.html`: the whole page.
- `api/data.js`: saves and loads data from the online database (a Vercel serverless function).

Opened by double-clicking, `index.html` works offline and keeps data in that browser only.
Once deployed on Vercel, it saves everything to the online database and the whole team shares one board.

## Put it live on Vercel

1. **Upload the code.** Push this folder to a GitHub repository. Or, from this folder, run `npx vercel` and follow the prompts.
2. **Create the project.** In Vercel, choose **Add New → Project**, import the repository, leave Framework Preset as **Other**, then **Deploy**.
3. **Add the database.** Open the project, go to **Storage → Create Database**, pick **Upstash for Redis** (the free plan is enough) and connect it to this project for all environments. Vercel adds the connection settings for you.
4. **Set the PINs.** Go to **Settings → Environment Variables** and add:
   - `ADMIN_PIN`: your PIN. It gives full access to designers, targets, holidays, leave, settings and counts.
   - `TEAM_PIN`: the PIN you give designers. They can only log image and video counts.
5. **Redeploy.** Go to **Deployments**, open the latest one and click **Redeploy**, so the new settings take effect.
6. **Open your site** and enter your admin PIN.

## Move existing data across

On the offline copy, go to **Settings → Download backup**. Then on the live site, go to **Settings → Load backup** and choose that file.

## Where the data is

All the data is in your Upstash Redis database, under these keys:

| Key | Contents |
|---|---|
| `tcb:settings` | Prize, default targets, weekly off days, counting rules |
| `tcb:designers` | One entry per designer |
| `tcb:logs` | One entry per designer per day |
| `tcb:holidays` | Company holidays |
| `tcb:leaves` | Designer leave |

You can view it in the Upstash console. **Settings → Download backup** saves a full copy as a JSON file.
