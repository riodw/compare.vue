<script setup lang="ts">
import {
  Send,
  XCircle,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
} from "lucide-vue-next"

const people = [
  {
    initials: "SS",
    name: "Sandy Shores",
    address: "3726 Bayberry Drive, Danielsville, PA 18038",
    lastStayStart: "Wed. Jun 12, 2015",
    lastStayEnd: "Thu. Jun 22, 2015",
  },
]
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- Breadcrumb -->
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Library</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <!-- Title and Invite -->
    <div class="flex items-end justify-between">
      <h1 class="text-3xl font-bold tracking-tight">17 People</h1>
      <Dialog>
        <DialogTrigger as-child>
          <Button>
            <Send class="mr-2 h-4 w-4" />
            Invite
            <span class="hidden sm:inline ml-1">New</span>
            Person
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modal title</DialogTitle>
            <DialogDescription>...</DialogDescription>
          </DialogHeader>
          <div class="py-4">...</div>
          <DialogFooter>
            <Button variant="secondary">Close</Button>
            <Button>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

    <!-- Search -->
    <div class="flex items-center gap-2">
      <div class="relative w-full max-w-sm">
        <Input placeholder="Search (Name, Address)" class="pr-10" />
        <Button
          variant="ghost"
          size="icon"
          class="absolute right-0 top-0 h-full text-muted-foreground hover:bg-transparent"
        >
          <XCircle class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Filters -->
    <Card>
      <CardContent class="p-0">
        <div
          class="flex items-center justify-between border-b px-4 py-3 last:border-0"
        >
          <span class="font-medium">0 Sorts</span>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="sm">
                <Plus class="mr-2 h-4 w-4" />
                Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Something else here</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Separated link</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <span class="font-medium">0 Filters</span>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="sm">
                <Plus class="mr-2 h-4 w-4" />
                Filter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Action</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>

    <!-- Data Table -->
    <div class="rounded-md border">
      <Table>
        <TableBody>
          <TableRow v-for="(person, i) in people" :key="i">
            <TableCell class="w-[80px]">
              <div
                class="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-400 font-semibold text-yellow-950"
              >
                {{ person.initials }}
              </div>
            </TableCell>
            <TableCell>
              <div class="font-bold">{{ person.name }}</div>
              <div class="text-sm text-muted-foreground">
                {{ person.address }}
              </div>
            </TableCell>
            <TableCell>
              <div class="italic">
                {{ person.lastStayStart }}
                <div class="text-muted-foreground">
                  {{ person.lastStayEnd }}
                </div>
              </div>
            </TableCell>
            <TableCell class="text-right">
              <div class="flex items-center justify-end gap-2">
                <Button variant="secondary" size="sm">
                  <Pencil class="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button variant="destructive" size="sm">
                  <Trash2 class="mr-2 h-4 w-4" />
                  Remove
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Pagination -->
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationLink href="#" is-active>1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">2</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">3</PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  </div>
</template>
