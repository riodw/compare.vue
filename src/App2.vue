<script setup lang="ts">
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  type SortingState,
  type VisibilityState,
  FlexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
} from "@tanstack/vue-table"
import { ArrowUpDown, ChevronDown, MoreHorizontal } from "lucide-vue-next"
import { h, resolveComponent, computed } from "vue"

import { valueUpdater } from "@/lib/utils"
// Components are auto-imported

// Initialize dark mode (defaults to dark)
useColorMode({
  initialValue: "dark",
})

export interface Payment {
  id: string
  amount: number
  status: "pending" | "processing" | "success" | "failed"
  email: string
}

const data: Payment[] = [
  {
    id: "m5gr84i9",
    amount: 316,
    status: "success",
    email: "ken99@yahoo.com",
  },
  {
    id: "3u1reuv4",
    amount: 242,
    status: "success",
    email: "Abe45@gmail.com",
  },
  {
    id: "derv1ws0",
    amount: 837,
    status: "processing",
    email: "Monserrat44@gmail.com",
  },
  {
    id: "5kma53ae",
    amount: 874,
    status: "success",
    email: "Silas22@gmail.com",
  },
  {
    id: "bhqecj4p",
    amount: 721,
    status: "failed",
    email: "carmella@hotmail.com",
  },
]

const [DefineTemplate, ReuseTemplate] = createReusableTemplate<{
  payment: {
    id: string
  }
  onExpand: () => void
}>()

const columns: ColumnDef<Payment>[] = [
  {
    id: "select",
    header: ({ table }) =>
      h(resolveComponent("Checkbox"), {
        "modelValue":
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate"),
        "onUpdate:modelValue": (value: any) =>
          table.toggleAllPageRowsSelected(!!value),
        "ariaLabel": "Select all",
      }),
    cell: ({ row }) =>
      h(resolveComponent("Checkbox"), {
        "modelValue": row.getIsSelected(),
        "onUpdate:modelValue": (value: any) => row.toggleSelected(!!value),
        "ariaLabel": "Select row",
      }),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) =>
      h("div", { class: "capitalize" }, row.getValue("status")),
  },
  {
    accessorKey: "email",
    header: ({ column }) => {
      return h(
        resolveComponent("Button"),
        {
          variant: "ghost",
          onClick: () => column.toggleSorting(column.getIsSorted() === "asc"),
        },
        () => ["Email", h(ArrowUpDown, { class: "ml-2 h-4 w-4" })]
      )
    },
    cell: ({ row }) => h("div", { class: "lowercase" }, row.getValue("email")),
  },
  {
    accessorKey: "amount",
    header: () => h("div", { class: "text-right" }, "Amount"),
    cell: ({ row }) => {
      const amount = Number.parseFloat(row.getValue("amount"))

      // Format the amount as a dollar amount
      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount)

      return h("div", { class: "text-right font-medium" }, formatted)
    },
  },
  {
    id: "actions",
    enableHiding: false,
    cell: ({ row }) => {
      const payment = row.original

      return h(ReuseTemplate, {
        payment,
        onExpand: row.toggleExpanded,
      })
    },
  },
]

const sorting = ref<SortingState>([])
const columnFilters = ref<ColumnFiltersState>([])
const columnVisibility = ref<VisibilityState>({})
const rowSelection = ref({})
const expanded = ref<ExpandedState>({})

const table = useVueTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getExpandedRowModel: getExpandedRowModel(),
  onSortingChange: (updaterOrValue) => valueUpdater(updaterOrValue, sorting),
  onColumnFiltersChange: (updaterOrValue) =>
    valueUpdater(updaterOrValue, columnFilters),
  onColumnVisibilityChange: (updaterOrValue) =>
    valueUpdater(updaterOrValue, columnVisibility),
  onRowSelectionChange: (updaterOrValue) =>
    valueUpdater(updaterOrValue, rowSelection),
  onExpandedChange: (updaterOrValue) => valueUpdater(updaterOrValue, expanded),
  state: {
    get sorting() {
      return sorting.value
    },
    get columnFilters() {
      return columnFilters.value
    },
    get columnVisibility() {
      return columnVisibility.value
    },
    get rowSelection() {
      return rowSelection.value
    },
    get expanded() {
      return expanded.value
    },
  },
})

function copy(id: string) {
  navigator.clipboard.writeText(id)
}
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>
      <header class="flex h-16 shrink-0 items-center gap-2">
        <div class="flex items-center gap-2 px-4">
          <SidebarTrigger class="-ml-1" />
          <Separator
            orientation="vertical"
            class="mr-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem class="hidden md:block">
                <BreadcrumbLink href="#">
                  Building Your Application
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator class="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Data Fetching</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div class="ml-auto flex items-center gap-2 px-4">
          <ModeToggle />
        </div>
      </header>
      <div class="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div class="grid auto-rows-min gap-4 md:grid-cols-3">
          <div class="bg-muted/50 aspect-video rounded-xl" />
          <div class="bg-muted/50 aspect-video rounded-xl" />
          <div class="bg-muted/50 aspect-video rounded-xl" />
        </div>
        <div
          class="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min p-4"
        >
          <DefineTemplate v-slot="{ payment }">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" class="h-8 w-8 p-0">
                  <span class="sr-only">Open menu</span>
                  <MoreHorizontal class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem @click="copy(payment.id)">
                  Copy payment ID
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>View customer</DropdownMenuItem>
                <DropdownMenuItem>View payment details</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </DefineTemplate>
          <div class="w-full">
            <div class="flex items-center py-4 gap-2">
              <Input
                class="max-w-sm"
                placeholder="Filter emails..."
                :model-value="
                  table.getColumn('email')?.getFilterValue() as string
                "
                @update:model-value="
                  table.getColumn('email')?.setFilterValue($event)
                "
              />
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="outline" class="ml-auto">
                    Columns
                    <ChevronDown class="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuCheckboxItem
                    v-for="column in table
                      .getAllColumns()
                      .filter((column) => column.getCanHide())"
                    :key="column.id"
                    class="capitalize"
                    :model-value="column.getIsVisible()"
                    @update:model-value="
                      (value) => {
                        column.toggleVisibility(!!value)
                      }
                    "
                  >
                    {{ column.id }}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div class="rounded-md border bg-background">
              <Table>
                <TableHeader>
                  <TableRow
                    v-for="headerGroup in table.getHeaderGroups()"
                    :key="headerGroup.id"
                  >
                    <TableHead
                      v-for="header in headerGroup.headers"
                      :key="header.id"
                    >
                      <FlexRender
                        v-if="!header.isPlaceholder"
                        :render="header.column.columnDef.header"
                        :props="header.getContext()"
                      />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <template v-if="table.getRowModel().rows?.length">
                    <template
                      v-for="row in table.getRowModel().rows"
                      :key="row.id"
                    >
                      <TableRow
                        :data-state="row.getIsSelected() && 'selected'"
                      >
                        <TableCell
                          v-for="cell in row.getVisibleCells()"
                          :key="cell.id"
                        >
                          <FlexRender
                            :render="cell.column.columnDef.cell"
                            :props="cell.getContext()"
                          />
                        </TableCell>
                      </TableRow>
                      <TableRow v-if="row.getIsExpanded()">
                        <TableCell :colspan="row.getAllCells().length">
                          {{ JSON.stringify(row.original) }}
                        </TableCell>
                      </TableRow>
                    </template>
                  </template>

                  <TableRow v-else>
                    <TableCell
                      :colspan="columns.length"
                      class="h-24 text-center"
                    >
                      No results.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div class="flex items-center justify-end space-x-2 py-4">
              <div class="flex-1 text-sm text-muted-foreground">
                {{ table.getFilteredSelectedRowModel().rows.length }} of
                {{ table.getFilteredRowModel().rows.length }} row(s) selected.
              </div>
              <div class="space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="!table.getCanPreviousPage()"
                  @click="table.previousPage()"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="!table.getCanNextPage()"
                  @click="table.nextPage()"
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
