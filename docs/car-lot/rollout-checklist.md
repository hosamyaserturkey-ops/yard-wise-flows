# Car lot: rollout checklist

For the owner (super admin) and the two car-lot staff. Plain steps, in order. Tick each one.
The car lot is already live in the app; nothing here needs a developer.

## Part 1. Set up (owner, once)

1. [ ] Sign in as the owner. At the top right, open the yard switcher and choose **Everest Logistics - Car Lot**.
   The menu changes to **Cars**, **Move a car**, **Lot map**, **Overview**, **Reports**, **Slots**, **Manufacturers**, **Yards** and **Users**. (Choose "All yards" to go back to the container yard.)
2. [ ] **Manufacturers > Add manufacturer** for each brand: a short code (2 to 10 letters or numbers, e.g. TOY, cannot be changed later), the name, and the free days (7 is the usual). The owner **or the car lot's own Yard Admin** can do this; only the owner creates a manufacturer's portal login (step 4).
3. [ ] **Users > Create user** for the two staff. Pick the car-lot yard, and a role:
   - **User** (office): can register cars, gate them out, hold and release, take inspections, print tickets.
   - **Inspector**: the same for cars and inspections.
   - **Yard Admin**: the same, and manages the lot's users and manufacturers' details.
   - **Read-only Admin (car lot)**: sees the lot, changes nothing.
4. [ ] **Manufacturers > Add login** for one manufacturer to start. Give them the password yourself (they are not notified).
5. [ ] Make sure a **printer** works from the computer or tablet at the gate (see Part 3, step 8).
6. [ ] **Slots** (owner or the car lot's Yard Admin; optional, but needed for scanning and the lot map):
   - **Add many** for each zone, e.g. zone **A**, rows **1 to 5**, slots **1 to 20** (names come out as A-01-01 … A-05-20). Leave the rows empty for a zone without rows (B-01, B-02 …).
   - **Add a slot** for single places, e.g. **RECEIVING** with kind **Receiving** and room for 10 cars (new cars are suggested there), or **EXIT**.
   - **Room** is how many cars fit in a slot (1 for a marked bay).
   - **Print all labels**: **Large** (1 per A4, for posts and walls) or **Stickers** (8 per A4). Put each label at its slot, where a phone can reach it.
   - Without slots, everything works as before: staff type the zone and slot.

## Part 2. Practice with a test car (owner and staff, before the first real car)

Use a made-up manufacturer, for example code **TEST**, name "Test Manufacturer". Use this VIN: `JTDKB20U093000001`.
(A VIN is 17 characters and never contains the letters I, O or Q.)

1. [ ] **Cars > Register car**: choose the test manufacturer, enter the VIN, a model, the driver and truck. Under **Spot**, keep the suggested receiving slot, pick another, press **Scan** and scan a slot label, or choose **Other spot (type it)**. Leave **Print the car tag** ticked: the tag prints (QR, VIN, ticket, spot); put it on the dashboard. The car appears under **In the lot**.
2. [ ] Press **In** on that car. On a **phone or tablet** tap a photo tile: the camera opens. Take all **10 required photos** (the 8 views round the car, dashboard, interior). Add one **damage photo** with a note ("what and where").
3. [ ] Fill odometer, fuel, keys. Press **Close inspection**. It cannot be changed afterwards.
4. [ ] Press **Print reception ticket**. Check it: VIN, spot, the damage note, and the signature lines.
5. [ ] Sign in as the **manufacturer login** (on a phone). Check the car and its photos show, and switch **English / العربية**. Check the Arabic reads well (tell the developer any word that sounds wrong).
6. [ ] **Hold**: write a reason (for example "practice"), then **Release hold**. While on hold, **Gate out** must be greyed out.
7. [ ] (With slots.) **Move a car** on a phone: scan the car tag, then a slot label, press **Move the car**. Open **Lot map**: the car shows in its new slot. **History** shows "Moved · scanned, on device-…".
8. [ ] (With slots.) Try a slot that is full: the app names the car in it and refuses. The Yard Admin or owner can still put the car there by writing a reason.
9. [ ] Press **Out** and do the departure inspection: the same 10 photos, then **Close inspection**. Until it is closed, **Gate out** stays greyed out.
10. [ ] **Gate out**: enter the driver and truck, press **Release car**. The release ticket opens by itself. Check it.
11. [ ] Press **History** on the car: the arrival, the hold (with its reason), the release of the hold and the gate-out are listed, each with who did it and when.
12. [ ] Print one ticket on the real printer: check the paper size (A4), margins and colour.

**Note:** test cars, their photos and visits **cannot be deleted from the app** (photos are evidence). They stay in the records and are removed automatically 12 months after release. To keep the real list clean, deactivate the TEST manufacturer afterwards (Manufacturers > Deactivate), or ask the developer to remove the test data.

## Part 3. Every day (staff)

**A car arrives**
1. **Cars > Register car**. Check the VIN twice (the app refuses a VIN that cannot be right).
2. Press **In** and do the walk-round photos. All 10 are needed to close. Retake any blurry one (the newest photo counts).
3. Note every scratch or dent as a damage photo with a note. This is what protects the lot later.
4. Close the inspection, **Print reception ticket**, get the driver's signature.

**A car must not leave yet:** press **Hold** and write why (for example "damage dispute" or "customs"). The app records who put it on hold and when. A held car cannot be gated out until you **Release hold**. A held car is also never deleted by the 12-month cleanup.

**A car leaves**
1. Press **Out** and do the departure inspection: the walk-round photos again, and a damage photo with a note for anything new. **Close inspection**. The app does not let a car leave before this is closed.
2. Press **Gate out**, enter the driver and truck, **Release car**. The release ticket opens: print it, get the driver's signature.

**A car is moved inside the lot** (anyone who may register cars)
1. **Move a car** (or **Move** on the car in the Cars list).
2. Which car: scan its **tag**; on Android phones the car's own **VIN barcode** also works; or press **Type VIN digits** and type the last few characters.
3. Where to: scan the **slot label**, or **Pick slot** (free places shown), or **Type spot** for a place without a label.
4. **Move the car**. A full slot is refused, naming the car already there. Only the Yard Admin or owner can put a car in a full slot, and must write why.
5. No camera? Allow the camera for the site in the browser's settings, or type the code. A hand scanner that types the code and presses Enter works in the same box.

**Correcting a mistake (Yard Admin or owner only):** press **Edit** on a car that is still in the lot to fix the VIN, model, year, colour, spot, driver, truck, keys, odometer or free days. The manufacturer and arrival time cannot be changed. Cars already released cannot be edited. Changing a VIN needs a reason. A car in a listed slot changes place with **Move**, not Edit.

**History:** press **History** on any car to see every arrival, move, edit, hold, release of a hold and gate-out: who, when, what changed (old and new value) and why; for a move also how (scanned, picked from the list or typed) and on which phone. Nobody can change or delete it.

**The lot at a glance:** **Overview** shows the cars in the lot, arrivals and releases (today and the last 30 days), cars on hold, cars past their free days, and cars whose arrival inspection is not closed yet, each a tap away. It updates itself every minute. **Reports** downloads Excel files: cars in the lot, movements (with a month-by-month summary), dwell time, damage and holds, for any period and manufacturer.

**The lot map:** **Lot map** shows every zone, row and slot with the cars in it (last 6 characters of the VIN, manufacturer, day in the lot, a mark for a car on hold), and the cars without a slot. Filter by manufacturer, or switch to a table. Tap a car to open it in the Cars list. It updates itself every minute.

**Reprints:** **Ticket** (once the arrival inspection is closed) and **Release ticket** (for released cars, under **Released**) buttons on the Cars list. A reprint still shows the person who handled the car, and who printed it. **Tag** reprints a car's tag; **Slots** reprints a slot's label (the printer button on its row).

## Part 4. Good to know

- **Photos are permanent evidence.** They can be added, never edited or deleted. A closed inspection never changes.
- **No money anywhere yet.** There is no billing, invoice or price. Free days are only counted ("+4 over free").
- **No liability wording** is printed on tickets or shown in the portal (not decided).
- **Manufacturers see only their own cars**, read-only, in English or Arabic. Photos of an inspection still in progress are not shown to them.
- **Cleanup:** 12 months after a car is released, its visit, inspection and photos are removed. Nothing is removed during the first year. The daily job needs one more setup step by the developer before it runs.
- **Lost password:** Users > Reset Password.
- **If a photo will not upload:** check the signal, try again; a photo over 5 MB is rejected (the app shrinks photos itself, so this is rare).
- **Slot labels keep working when a slot changes room or kind.** A slot cannot be renamed or deleted: add the new one and take the old one out of use (Slots > pencil > In use off). A slot with cars in it stays in use.
- **"device-7f3a" in the history** is a label the app gives each phone or PC, to tell devices apart. It is not a person.
- **Scanning** needs the app's normal https address and camera permission. iPhones read the QR codes (tags and labels); Android phones also read VIN barcodes.

## Part 5. Please check and report

- [ ] The Arabic wording in the portal (a native reader should go through it once).
- [ ] One real manufacturer login on a real phone.
- [ ] One ticket printed on the real printer.
- [ ] (With slots.) A printed label and a car tag scanned with each phone used in the lot, in daylight and under the lot's lights.
