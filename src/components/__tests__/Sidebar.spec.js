import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Sidebar from "../Sidebar.vue";

const notes = [
  { id: "1", title: "First", updatedAt: Date.now() },
  { id: "2", title: "Second", updatedAt: Date.now() },
];

describe("Sidebar (dumb component)", () => {
  it("emits create when the New button is clicked", async () => {
    const wrapper = mount(Sidebar, {
      props: { notes, activeId: "1", disabled: false },
    });
    await wrapper.get("button.new").trigger("click");
    expect(wrapper.emitted("create")).toHaveLength(1);
  });

  it("emits select with the note id when a row is clicked", async () => {
    const wrapper = mount(Sidebar, {
      props: { notes, activeId: "1", disabled: false },
    });
    await wrapper.findAll(".item")[1].trigger("click");
    expect(wrapper.emitted("select")[0]).toEqual(["2"]);
  });

  it("emits delete with the note id, without also emitting select", async () => {
    const wrapper = mount(Sidebar, {
      props: { notes, activeId: "1", disabled: false },
    });
    await wrapper.findAll(".item")[0].get("button.trash").trigger("click");
    expect(wrapper.emitted("delete")[0]).toEqual(["1"]);
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("does not emit select while disabled (recording)", async () => {
    const wrapper = mount(Sidebar, {
      props: { notes, activeId: "1", disabled: true },
    });
    await wrapper.findAll(".item")[1].trigger("click");
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("shows the empty state when there are no notes", () => {
    const wrapper = mount(Sidebar, {
      props: { notes: [], activeId: null, disabled: false },
    });
    expect(wrapper.get(".empty").text()).toBe("No notes yet");
  });
});
