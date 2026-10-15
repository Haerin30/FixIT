
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
    // 1. Create the initial user roles.
    const roles = [
        "Customer",
        "Technician",
        "Administrator",
    ];

    for (const name of roles) {
        await prisma.role.upsert({
            where: { name },
            update: {},
            create: { name },
        });
    }

    console.log("User roles seeded successfully.");

    // 2. Create the initial repair categories.
    const categories = [
        {
            name: "Laptop Repair",
            description: "Diagnosis and repair of laptop problems.",
        },
        {
            name: "Desktop Repair",
            description: "Diagnosis and repair of desktop computers.",
        },
        {
            name: "Hardware Upgrade",
            description: "RAM, SSD, storage, and other hardware upgrades.",
        },
        {
            name: "Software Troubleshooting",
            description: "Operating system, application, and software issues.",
        },
        {
            name: "Virus and Malware Removal",
            description: "Detection and removal of malicious software.",
        },
        {
            name: "Data Recovery",
            description: "Recovery of lost or inaccessible files.",
        },
        {
            name: "Network and Wi-Fi Issues",
            description: "Troubleshooting computer network connections.",
        },
        {
            name: "Printer Repair",
            description: "Troubleshooting printer hardware and software.",
        },
    ];

    for (const category of categories) {
        await prisma.repairCategory.upsert({
            where: { name: category.name },
            update: {},
            create: category,
        });
    }

    console.log("Repair categories seeded successfully.");
}

main()
    .catch((error) => {
        console.error("Seeding failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
