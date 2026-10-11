<template>
  <div class="switch-root">
    <SelectionControls></SelectionControls>
    <div class="switch-groups">
      <div v-for="(cate, index) in cates" :key="cate" class="switch-group">
        <div class="switch-group-title">{{ trans[cate] }}</div>
        <div class="switch-grid">
          <div
            v-for="action in groupActions[index]"
            :key="action.id"
            :class="['switch-item', actionItemClass(action)]"
          >
            <Action :identifier="action.id"></Action>
          </div>
        </div>
      </div>
    </div>
    <div class="switch-restore">
      <SimpleButton @click="restore">{{ trans["restoreMultiDefault"] }}</SimpleButton>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop } from "vue-property-decorator";
import KeyConfig from "@/components/KeyConfig.vue";
import { Identifier, Category, ActionView } from "../common/types";
import Action from "../components/Action.vue";
import SimpleButton from "@/components/SimpleButton.vue";
import SelectionControls from "@/components/SelectionControls.vue";
import Base from "@/components/Base.vue";

@Component({
  components: {
    KeyConfig,
    Action,
    SimpleButton,
    SelectionControls,
  },
})
export default class SwitchGroups extends Base {
  @Prop({ default: [] }) readonly cates!: Category[];
  actionKeys: Array<Identifier[]> = this.cates.map((x) =>
    this.$controller.action.getKeys(x as Category).filter(id => !["selectionPopup", "selectionPopupTrigger", "selectionPermission"].includes(id))
  );
  groupActions: Array<ActionView[]> = this.actionKeys.map((keys) =>
    keys.map((id) => this.$controller.action.getAction(id))
  );

  actionItemClass(action: ActionView) {
    if (action.layout?.span && action.layout.span >= 1) {
      return "switch-item-full";
    }
    return "";
  }

  restore() {
    for (const cate of this.cates) {
      this.callback("restoreMultiDefault", cate);
    }
  }
}
</script>

<style scoped>
.switch-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.switch-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.switch-group {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.switch-group-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.switch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
}
.switch-item-full {
  grid-column: 1 / -1;
}
.switch-restore {
  margin-top: 4px;
}
@media (max-width: 520px) {
  .switch-grid {
    grid-template-columns: 1fr;
  }
}
</style>
