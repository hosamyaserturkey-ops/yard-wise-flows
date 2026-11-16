# Car lot: rollout checklist

For the owner (super admin) and the two car-lot staff. Plain steps, in order. Tick each one.
The car lot is already live in the app; nothing here needs a developer.

## Part 1. Set up (owner, once)

1. [ ] Sign in as the owner. At the top right, open the yard switcher and choose **Everest Logistics - Car Lot**.
   The menu changes to **Cars**, **Manufacturers**, **Yards** and **Users**. (Choose "All yards" to go back to the container yard.)
2. [ ] **Manufacturers > Add manufacturer** for each brand: a short code (2 to 10 letters or numbers, e.g. TOY, cannot be changed later), the name, and the free days (7 is the usual). The owner **or the car lot's own Yard Admin** can do this; only the owner creates a manufacturer's portal login (step 4).
3. [ ] **Users > Create user** for the two staff. Pick the car-lot yard, and a role:
   - **User** (office): can register cars, gate them out, hold and release, take inspections, print tickets.
   - **Inspector**: the same for cars and inspections.
   - **Yard Admin**: the same, and manages the lot's users and manufacturers' details.
   - **Read-only Admin (car lot)**: sees the lot, changes nothing.
4. [ ] **Manufacturers > Add login** for one manufacturer to start. Give them the password yourself (they are not notified).
5. [ ] Make sure a **printer** works from the computer or tablet at the gate (see Part 3, step 8).

## Part 2. Practice with a test car (owner and staff, before the first real car)

Use a made-up manufacturer, for example code **TEST**, name "Test Manufacturer". Use this VIN: `JTDKB20U093000001`.
(A VIN is 17 characters and never contains the letters I, O or Q.)

1. [ ] **Cars > Register car**: choose the test manufacturer, enter the VIN, a model, a spot, the driver and truck. The car appears under **In the lot**.
2. [ ] Press **In** on that car. On a **phone or tablet** tap a photo tile: the camera opens. Take all **10 required photos** (the 8 views round the car, dashboard, interior). Add one **damage photo** with a note ("what and where").
3. [ ] Fill odometer, fuel, keys. Press **Close inspection**. It cannot be changed afterwards.
4. [ ] Press **Print reception ticket**. Check it: VIN, spot, the damage note, and the signature lines.
5. [ ] Sign in as the **manufacturer login** (on a phone). Check the car and its photos show, and switch **English / العربية**. Check the Arabic reads well (tell the developer any word that sounds wrong).
6. [ ] **Hold**, then **Release hold**. While on hold, **Gate out** must be greyed out.
7. [ ] **Gate out**: enter the driver and truck, press **Release car**. The release ticket opens by itself. Check it.
8. [ ] Print one ticket on the real printer: check the paper size (A4), margins and colour.

**Note:** test cars, their photos and visits **cannot be deleted from the app** (photos are evidence). They stay in the records and are removed automatically 12 months after release. To keep the real list clean, deactivate the TEST manufacturer afterwards (Manufacturers > Deactivate), or ask the developer to remove the test data.

## Part 3. Every day (staff)

**A car arrives**
1. **Cars > Register car**. Check the VIN twice (the app refuses a VIN that cannot be right).
2. Press **In** and do the walk-round photos. All 10 are needed to close. Retake any blurry one (the newest photo counts).
3. Note every scratch or dent as a damage photo with a note. This is what protects the lot later.
4. Close the inspection, **Print reception ticket**, get the driver's signature.

**A car must not leave yet:** press **Hold**. A held car cannot be gated out until you **Release hold**. A held car is also never deleted by the 12-month cleanup.

**A car leaves**
1. Press **Out** and do the departure inspection if you want a record (not required by the app).
2. Press **Gate out**, enter the driver and truck, **Release car**. The release ticket opens: print it, get the driver's signature.

**Reprints:** **Ticket** and **Release ticket** buttons on the Cars list. A reprint still shows the person who handled the car, and who printed it.

## Part 4. Good to know

- **Photos are permanent evidence.** They can be added, never edited or deleted. A closed inspection never changes.
- **No money anywhere yet.** There is no billing, invoice or price. Free days are only counted ("+4 over free").
- **No liability wording** is printed on tickets or shown in the portal (not decided).
- **Manufacturers see only their own cars**, read-only, in English or Arabic. Photos of an inspection still in progress are not shown to them.
- **Cleanup:** 12 months after a car is released, its visit, inspection and photos are removed. Nothing is removed during the first year. The daily job needs one more setup step by the developer before it runs.
- **Lost password:** Users > Reset Password.
- **If a photo will not upload:** check the signal, try again; a photo over 5 MB is rejected (the app shrinks photos itself, so this is rare).

## Part 5. Please check and report

- [ ] The Arabic wording in the portal (a native reader should go through it once).
- [ ] One real manufacturer login on a real phone.
- [ ] One ticket printed on the real printer.
