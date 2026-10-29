import { describe, expect, it } from "vitest";
import { ALL, filterAvailableContainers, lineKey, lineOptions, typeOptions } from "../availableContainers";

const make = (containerNumber: string, containerType: string, shippingLine: string, driverName = "", truckNumber = "") => ({
  containerNumber,
  containerType,
  shippingLine,
  driverName,
  truckNumber,
});

const containers = [
  make("MSKU1234567", "40HC", "WOM", "Ahmad Saleh", "12-34567"),
  make("TGHU7654321", "20GP", "EEL", "Omar Khaled", "98-76543"),
  make("CAIU1111111", "40HC", "7Seas", "Ahmad Saleh", "55-55555"),
];

const noFilters = { query: "", type: ALL, line: ALL };

describe("filterAvailableContainers", () => {
  it("keeps everything with no filters", () => {
    expect(filterAvailableContainers(containers, noFilters)).toHaveLength(3);
  });

  it("finds a container by part of its number, ignoring case, spaces and dashes", () => {
    const hits = (query: string) =>
      filterAvailableContainers(containers, { ...noFilters, query }).map((c) => c.containerNumber);
    expect(hits("msku")).toEqual(["MSKU1234567"]);
    expect(hits("TGHU 765432-1")).toEqual(["TGHU7654321"]);
  });

  it("also searches the driver and the truck", () => {
    expect(filterAvailableContainers(containers, { ...noFilters, query: "ahmad" })).toHaveLength(2);
    expect(filterAvailableContainers(containers, { ...noFilters, query: "9876543" })).toHaveLength(1);
  });

  it("narrows by type and by line, comparing lines case-insensitively", () => {
    expect(filterAvailableContainers(containers, { ...noFilters, type: "40HC" })).toHaveLength(2);
    expect(filterAvailableContainers(containers, { ...noFilters, line: lineKey("7seas") })).toHaveLength(1);
    expect(
      filterAvailableContainers(containers, { query: "ahmad", type: "40HC", line: lineKey("WOM") }).map(
        (c) => c.containerNumber,
      ),
    ).toEqual(["MSKU1234567"]);
  });
});

describe("options", () => {
  it("lists each type once, sorted", () => {
    expect(typeOptions(containers)).toEqual(["20GP", "40HC"]);
  });

  it("lists each line once by key, keeping the first spelling as the label", () => {
    expect(lineOptions([...containers, make("X", "20GP", "7SEAS")])).toEqual([
      { key: "7SEAS", label: "7Seas" },
      { key: "EEL", label: "EEL" },
      { key: "WOM", label: "WOM" },
    ]);
  });
});
