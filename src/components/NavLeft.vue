<script setup lang="ts">
import {
  Home,
  Users,
  Building,
  CalendarRange,
  BarChart2,
  ChevronRight,
  House,
  MessageCircleHeart,
} from "lucide-vue-next"

const items = [
  { title: "Home", url: "/", icon: Home },
  { title: "People", url: "/people", icon: Users },
  { title: "Properties", url: "/properties", icon: Building },
  { title: "Calendar", url: "/calendar", icon: CalendarRange },
  { title: "Schedule", url: "/schedule", icon: BarChart2 },
  { title: "Notion", url: "/notion", icon: null }, // No icon in original but kept structure
]
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in items" :key="item.title">
              <SidebarMenuButton as-child>
                <a :href="item.url">
                  <component :is="item.icon" v-if="item.icon" />
                  <span>{{ item.title }}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <Collapsible as-child class="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger as-child>
                  <SidebarMenuButton tooltip="Get Started">
                    <ChevronRight
                      class="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                    />
                    <span class="font-bold">Get Started</span>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton as-child>
                        <a href="#">
                          <House class="h-4 w-4 mr-2" />
                          <span>About Campfire</span>
                        </a>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton as-child>
                        <a href="#">
                          <MessageCircleHeart class="h-4 w-4 mr-2" />
                          <span>Say Hello</span>
                        </a>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarRail />
  </Sidebar>
</template>
